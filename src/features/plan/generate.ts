/**
 * Plan generation (P2 / THE HOOK). One `ai.complete` call turns the wizard's
 * inputs into a structured plan, guarded by the safety layers:
 *   - the system prompt opens "wellness coach, not a doctor",
 *   - the user's injury-excluded movements are injected as a hard avoid-list,
 *   - the result is validated (validate.ts); on failure we retry once, then
 *     drop to a hardcoded fallback template.
 *
 * `createPlan` is the single entry point the wizard calls; it returns the
 * assembled, ready-to-save domain `Plan` plus whether the fallback was used.
 */

import type { LiabilityAck, Plan, PlanGoal } from "../../types";
import { complete } from "../../bridge/ai";
import { newId } from "../../data/id";
import { shiftDate, todayISO } from "../diary";
import { movementsExcludedFor } from "../safety/injuryExclusions";
import type { GeneratedGoal, GeneratedPlan, PlanInput } from "./model";
import { modeHasWorkouts, modeTracksFood } from "./model";
import { validatePlan } from "./validate";
import { fallbackPlan } from "./fallbackTemplates";

const SYSTEM = `You are a wellness coach, not a doctor. You give friendly suggestions, not medical prescriptions.
Design a short, realistic wellness plan from the user's inputs. Return ONLY a JSON object:
  { "summary": string,
    "dailyCalorieTarget": number | null,
    "goals": [ { "label": string, "kind": "nutrition" | "workout" | "habit", "detail"?: string } ] }
Rules:
- "summary" is one encouraging sentence framing the plan.
- "dailyCalorieTarget" is a sensible daily kcal number when the plan tracks food, else null. Never below a safe floor (~1200-1500). No crash diets.
- 3 to 6 goals, each a short daily/weekly action. Use "nutrition" for food, "workout" for exercise, "habit" for everything else.
- For a "workout" goal, put the specific movements in "detail" (comma-separated).
- Keep it beginner-appropriate and equipment-light unless told otherwise.
- Output ONLY the JSON. No prose, no markdown fences.`;

const MAX_GOALS = 8;

/** Build the per-request user message from the wizard inputs + safety avoid-list. */
function buildUserPrompt(input: PlanInput): string {
  const lines: string[] = [];
  lines.push(`Mode: ${input.mode}.`);
  lines.push(`Goal in their words: "${input.goalText || "(none given)"}".`);
  lines.push(`Plan length: ${input.durationWeeks} week(s).`);
  if (modeHasWorkouts(input.mode)) {
    if (input.daysPerWeek) lines.push(`Workout days per week: ${input.daysPerWeek}.`);
    lines.push(`Equipment: ${input.equipment?.trim() || "none / bodyweight"}.`);
  }
  if (modeTracksFood(input.mode)) {
    if (input.heightCm) lines.push(`Height: ${input.heightCm} cm.`);
    if (input.weightKg) lines.push(`Weight: ${input.weightKg} kg.`);
    if (input.sex) lines.push(`Sex (for calorie floor only): ${input.sex}.`);
  }
  const avoid = movementsExcludedFor(input.safety.injuries);
  if (avoid.length) {
    lines.push(
      `HARD SAFETY RULE — the user has injuries, so NEVER include any movement matching these terms: ${avoid.join(", ")}.`,
    );
  }
  if (input.safety.ageBand === "60_plus") lines.push("Keep intensity gentle (older adult).");
  return lines.join("\n");
}

const clampKcal = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(6000, Math.round(n));
};

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

const VALID_KINDS = new Set<GeneratedGoal["kind"]>(["nutrition", "workout", "habit"]);

function parseGenerated(raw: string): GeneratedPlan | null {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const rawGoals = Array.isArray(o.goals) ? o.goals : [];
  const goals: GeneratedGoal[] = [];
  for (const g of rawGoals.slice(0, MAX_GOALS)) {
    if (!g || typeof g !== "object") continue;
    const go = g as Record<string, unknown>;
    const label = typeof go.label === "string" ? go.label.trim().slice(0, 120) : "";
    if (!label) continue;
    const kind = VALID_KINDS.has(go.kind as GeneratedGoal["kind"])
      ? (go.kind as GeneratedGoal["kind"])
      : "habit";
    const detail = typeof go.detail === "string" ? go.detail.trim().slice(0, 200) : undefined;
    goals.push(detail ? { label, kind, detail } : { label, kind });
  }
  if (goals.length === 0) return null;
  return {
    summary: typeof o.summary === "string" ? o.summary.trim().slice(0, 200) : "Your plan",
    dailyCalorieTarget: clampKcal(o.dailyCalorieTarget),
    goals,
  };
}

/** One AI generation attempt. Throws on transport error; returns null on unparseable output. */
export async function generatePlan(input: PlanInput): Promise<GeneratedPlan | null> {
  const raw = await complete({
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
    maxTokens: 1024,
    tier: "capable",
  });
  return parseGenerated(raw);
}

/** Convert a generated plan + wizard inputs + ack into the persisted domain Plan. */
export function buildPlan(gen: GeneratedPlan, input: PlanInput, liability: LiabilityAck): Plan {
  const startDate = todayISO();
  const endDate = shiftDate(startDate, input.durationWeeks * 7 - 1);
  const goals: PlanGoal[] = gen.goals.map((g, i) => {
    const goal: PlanGoal = { id: `${i}-${newId()}`, label: g.label, kind: g.kind };
    // Stash the calorie target on the first nutrition goal so the home screen
    // can read it back; otherwise carry the AI's movement detail through.
    if (g.detail) goal.detail = g.detail;
    return goal;
  });
  return {
    id: newId(),
    mode: input.mode,
    durationWeeks: input.durationWeeks,
    startDate,
    endDate,
    goals,
    safety: input.safety,
    liability,
    createdAt: new Date().toISOString(),
  };
}

export interface CreatePlanResult {
  plan: Plan;
  gen: GeneratedPlan;
  usedFallback: boolean;
}

/**
 * The wizard's one call: generate → validate → retry once → fallback template.
 * Never throws — a total failure still yields a safe fallback plan.
 */
export async function createPlan(input: PlanInput, liability: LiabilityAck): Promise<CreatePlanResult> {
  const ctx = { mode: input.mode, sex: input.sex, safety: input.safety };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const candidate = await generatePlan(input);
      if (candidate && validatePlan(candidate, ctx).ok) {
        return { plan: buildPlan(candidate, input, liability), gen: candidate, usedFallback: false };
      }
    } catch {
      // transport error — fall through to the next attempt / fallback
    }
  }
  const gen = fallbackPlan(input.mode, input);
  return { plan: buildPlan(gen, input, liability), gen, usedFallback: true };
}
