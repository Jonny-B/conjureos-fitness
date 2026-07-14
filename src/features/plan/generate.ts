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

import type { LiabilityAck, Plan, PlanGoal, PlanTargets } from "../../types";
import { complete, isAiAvailable } from "../../bridge/ai";
import { newId } from "../../data/id";
import { shiftDate, todayISO } from "../diary";
import { macrosForCalories } from "../goals";
import { movementsExcludedFor } from "../safety/injuryExclusions";
import type { GeneratedGoal, GeneratedPlan, PlanInput } from "./model";
import { modeHasWorkouts, modeTracksFood } from "./model";
import { parseProgram } from "./program";
import { validatePlan } from "./validate";
import { fallbackPlan } from "./fallbackTemplates";

const SYSTEM = `You are a wellness coach, not a doctor. You give friendly suggestions, not medical prescriptions.
Design a specific, personalized wellness plan from the user's inputs — tailored to THEIR stated goal, experience level, equipment, and schedule. Avoid generic filler. Return ONLY a JSON object:
  { "summary": string,
    "dailyCalorieTarget": number | null,
    "goals": [ { "label": string, "kind": "nutrition" | "workout" | "habit", "detail"?: string } ],
    "program"?: {
      "workouts": [ { "name": string, "kind"?: "strength" | "run" | "bike",
                      "exercises": [ { "name": string,
                                       "sets": [ { "reps"?: number, "durationSec"?: number, "restSec"?: number, "weightKg"?: number } ],
                                       "notes"?: string } ] } ],
      "benchmark": { "exercise": string, "metric": "reps" | "weightKg" | "durationSec" | "distanceKm", "target": number, "unit": string, "lowerIsBetter"?: boolean }
    } }
Rules:
- "summary" is one encouraging sentence naming what THIS plan will do for their specific goal.
- "dailyCalorieTarget" is optional — if unsure, use null; the app supplies its own number.
- 3 to 6 goals, each a short daily/weekly action tied to their goal. Use "nutrition" for food, "workout" for exercise, "habit" for everything else. For a "workout" goal, put the specific movements in "detail".
- Include "program" whenever the mode prescribes workouts (get_fit / both). Make it SPECIFIC to their goal and experience:
  - Give one workout per training day (match "days per week"), up to 6, each a distinct session (e.g. push / pull / legs / conditioning), 3-8 exercises each.
  - If the user named a specific target (e.g. "the Murph", a 5k, a pull-up), build the workouts to train for it and set the benchmark to that exact effort.
  - Scale difficulty to experience: beginner = form + lighter volume; intermediate/advanced = higher volume, progression, named lifts. Include a warmup note in the first exercise's "notes".
  - Sets have reps OR durationSec, plus restSec (metric units: kg, km, seconds).
  - EXACTLY ONE benchmark: a single measurable effort the plan improves; its exercise SHOULD appear in a workout. set lowerIsBetter=true for a timed effort.
- Respect the user's equipment and any HARD SAFETY avoid-list exactly.
- Output ONLY the JSON. No prose, no markdown fences.`;

const MAX_GOALS = 8;

/** Build the per-request user message from the wizard inputs + safety avoid-list.
 *  `priorReasons` (retry only) tells the model exactly why the last attempt was
 *  rejected so it can fix it instead of repeating the mistake. */
function buildUserPrompt(input: PlanInput, priorReasons?: string[]): string {
  const lines: string[] = [];
  lines.push(`Mode: ${input.mode}.`);
  lines.push(`Goal in their words: "${input.goalText || "(none given)"}".`);
  lines.push(`Plan length: ${input.durationWeeks} week(s).`);
  if (input.experienceLevel) lines.push(`Training experience: ${input.experienceLevel}.`);
  if (modeHasWorkouts(input.mode)) {
    if (input.daysPerWeek) lines.push(`Workout days per week: ${input.daysPerWeek} (give about this many distinct workouts).`);
    lines.push(`Equipment: ${input.equipment?.trim() || "none / bodyweight"}.`);
  }
  if (modeTracksFood(input.mode)) {
    if (input.heightCm) lines.push(`Height: ${input.heightCm} cm.`);
    if (input.weightKg) lines.push(`Weight: ${input.weightKg} kg.`);
    if (input.goalWeightKg) {
      const dir = input.weightKg && input.goalWeightKg < input.weightKg ? "lose" : input.weightKg && input.goalWeightKg > input.weightKg ? "gain" : "reach";
      lines.push(`Goal weight: ${input.goalWeightKg} kg (they want to ${dir} weight to reach it) — reference it in the plan.`);
    }
    if (input.age) lines.push(`Age: ${input.age}.`);
    if (input.sex) lines.push(`Sex (for calorie floor only): ${input.sex}.`);
  }
  const avoid = movementsExcludedFor(input.safety.injuries);
  if (avoid.length) {
    lines.push(
      `HARD SAFETY RULE — the user has injuries, so NEVER include any movement matching these terms: ${avoid.join(", ")}.`,
    );
  }
  if (input.safety.ageBand === "60_plus") lines.push("Keep intensity gentle (older adult).");
  if (priorReasons?.length) {
    lines.push(
      `Your previous attempt was REJECTED for: ${priorReasons.join("; ")}. Fix these exactly and return valid JSON.`,
    );
  }
  return lines.join("\n");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/** Keys a model might use for a goal's user-facing text (schema drift tolerance). */
const GOAL_LABEL_KEYS = ["label", "text", "name", "title", "goal", "description"];

/** Guess a goal's kind from its wording when the model omits/mislabels it. */
function inferKind(text: string): GeneratedGoal["kind"] {
  const t = text.toLowerCase();
  if (/\b(cal|calorie|protein|carb|fat|eat|food|meal|nutrition|hydrat|water|diet)\b/.test(t)) return "nutrition";
  if (/\b(workout|exercise|run|walk|jog|bike|lift|rep|set|squat|push|pull|plank|cardio|strength|train|session|mile|5k|murph)\b/.test(t))
    return "workout";
  return "habit";
}

/**
 * Coerce one goal entry into our shape. Tolerant on purpose: the hosted
 * free-tier model (Haiku) often returns goals as plain strings or with a
 * different key than "label"/"kind" — the strict old parser rejected those and
 * forced the fallback ("AI response couldn't be understood"). Accept strings,
 * alternate label keys, and a missing/odd kind (inferred from the wording).
 */
function coerceGoal(g: unknown): GeneratedGoal | null {
  if (typeof g === "string") {
    const label = g.trim().slice(0, 120);
    return label ? { label, kind: inferKind(label) } : null;
  }
  if (!g || typeof g !== "object") return null;
  const go = g as Record<string, unknown>;
  let label = "";
  for (const k of GOAL_LABEL_KEYS) {
    const v = go[k];
    if (typeof v === "string" && v.trim()) {
      label = v.trim().slice(0, 120);
      break;
    }
  }
  if (!label) return null;
  const detail = typeof go.detail === "string" ? go.detail.trim().slice(0, 200) : undefined;
  const kind = VALID_KINDS.has(go.kind as GeneratedGoal["kind"])
    ? (go.kind as GeneratedGoal["kind"])
    : inferKind(`${label} ${detail ?? ""}`);
  return detail ? { label, kind, detail } : { label, kind };
}

function parseGenerated(raw: string): GeneratedPlan | null {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  // Some models nest everything under a top-level "plan" wrapper.
  const inner = (o.plan && typeof o.plan === "object" ? (o.plan as Record<string, unknown>) : o);

  // Goals may arrive as an array (of objects OR strings) or an object map.
  const rawGoals = Array.isArray(inner.goals)
    ? inner.goals
    : inner.goals && typeof inner.goals === "object"
      ? Object.values(inner.goals as Record<string, unknown>)
      : [];
  const goals: GeneratedGoal[] = [];
  for (const g of rawGoals.slice(0, MAX_GOALS)) {
    const goal = coerceGoal(g);
    if (goal) goals.push(goal);
  }
  if (goals.length === 0) return null;
  const program = parseProgram(inner.program) ?? undefined;
  const summary =
    typeof inner.summary === "string" ? inner.summary.trim().slice(0, 200)
    : typeof inner.overview === "string" ? (inner.overview as string).trim().slice(0, 200)
    : "Your plan";
  return {
    summary,
    dailyCalorieTarget: clampKcal(inner.dailyCalorieTarget ?? inner.calorieTarget ?? inner.calories),
    goals,
    ...(program ? { program } : {}),
  };
}

/** One AI generation attempt. Throws on transport error; returns null on unparseable output. */
export async function generatePlan(input: PlanInput, priorReasons?: string[]): Promise<GeneratedPlan | null> {
  const raw = await complete({
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserPrompt(input, priorReasons) }],
    maxTokens: 2048,
    tier: "capable",
  });
  return parseGenerated(raw);
}

/** Convert a generated plan + wizard inputs + ack into the persisted domain Plan. */
export function buildPlan(gen: GeneratedPlan, input: PlanInput, liability: LiabilityAck): Plan {
  const startDate = input.startDate ?? todayISO();
  const endDate = input.endDate ?? shiftDate(startDate, input.durationWeeks * 7 - 1);
  const goals: PlanGoal[] = gen.goals.map((g, i) => {
    const goal: PlanGoal = { id: `${i}-${newId()}`, label: g.label, kind: g.kind };
    // Carry the AI's movement/nutrition detail through for future automation.
    if (g.detail) goal.detail = g.detail;
    return goal;
  });
  // Structured targets: the calorie target plus a macro split, so the plan — not
  // a free-text goal string — is the source of truth the diary rings read from.
  // Prefer the locally-computed target (Mifflin) over the AI's number.
  const kcal = input.calorieTarget ?? gen.dailyCalorieTarget;
  const targets: PlanTargets =
    kcal != null ? { dailyCalories: kcal, ...macrosForCalories(kcal, input.weightKg ?? 70) } : { dailyCalories: null };
  return {
    id: newId(),
    mode: input.mode,
    durationWeeks: input.durationWeeks,
    startDate,
    endDate,
    goals,
    targets,
    safety: input.safety,
    liability,
    createdAt: new Date().toISOString(),
    // Attach the adaptive program (W4) when generation produced one and the
    // mode actually prescribes workouts. Food-only plans never carry a program.
    ...(gen.program && modeHasWorkouts(input.mode) ? { program: gen.program } : {}),
  };
}

/** Coarse phase the wizard shows while a plan is being built. */
export type PlanStage = "calories" | "workouts" | "checking";

export interface CreatePlanOptions {
  /** Fires as generation moves through its real phases (for the spinner). */
  onStage?: (stage: PlanStage) => void;
}

export interface CreatePlanResult {
  plan: Plan;
  gen: GeneratedPlan;
  usedFallback: boolean;
  /** When usedFallback, WHY — the AI error or the validation reasons. Surfaced
   *  for diagnostics instead of being silently swallowed. */
  failureReason?: string;
}

/**
 * The wizard's plan call: generate → validate → retry (with the reasons) →
 * fallback template. Never throws. The calorie target is supplied locally
 * (`input.calorieTarget`, from Mifflin) so a plan is NOT rejected just because
 * the model omitted the number — the #1 cause of unwanted fallbacks. When it
 * does fall back, `failureReason` records exactly why.
 */
export async function createPlan(
  input: PlanInput,
  liability: LiabilityAck,
  opts?: CreatePlanOptions,
): Promise<CreatePlanResult> {
  const ctx = { mode: input.mode, sex: input.sex, safety: input.safety };
  const onStage = opts?.onStage;

  // The app owns the calorie target; the AI never needs to supply it.
  const withTarget = (g: GeneratedPlan): GeneratedPlan =>
    input.calorieTarget != null ? { ...g, dailyCalorieTarget: input.calorieTarget } : g;

  let lastReasons: string[] = [];
  let lastError: string | undefined;

  // The calorie + safety phases are near-instant, so without a small dwell the
  // spinner would only ever visibly show "Building your workouts". These pauses
  // make the honest three-stage readout actually readable.
  onStage?.("calories");
  await sleep(650);

  if (!isAiAvailable()) {
    lastError = "the AI service isn't available in this environment";
  } else {
    for (let attempt = 0; attempt < 2; attempt++) {
      onStage?.("workouts");
      try {
        const raw = await generatePlan(input, attempt > 0 ? lastReasons : undefined);
        if (!raw) {
          lastError = "the AI response couldn't be understood";
          // Give the retry concrete guidance instead of repeating the mistake.
          lastReasons = [
            'return ONLY a JSON object with a top-level "goals" array of 3-6 items, each { "label": string, "kind": "nutrition"|"workout"|"habit" }',
          ];
          continue;
        }
        const candidate = withTarget(raw);
        onStage?.("checking");
        await sleep(500);
        const v = validatePlan(candidate, ctx);
        if (v.ok) {
          return { plan: buildPlan(candidate, input, liability), gen: candidate, usedFallback: false };
        }
        lastReasons = v.reasons;
        lastError = undefined;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  onStage?.("checking");
  await sleep(500);
  const gen = withTarget(fallbackPlan(input.mode, input));
  const failureReason = lastError ?? (lastReasons.length ? lastReasons.join("; ") : "unknown");
  return { plan: buildPlan(gen, input, liability), gen, usedFallback: true, failureReason };
}
