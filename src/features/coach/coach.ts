/**
 * The coach's AI interface — evaluate a submitted check-in, chat free-form,
 * and (in either) apply a SMALL plan adjustment. Adjustments reuse the exact
 * machinery of the adaptation engine (analyze.ts): same bounded op set, same
 * applyAdjustment, same validateProgram rails — so nothing the coach does can
 * degrade a valid plan; a failed parse/validation is a strict no-op.
 */

import type { Plan } from "../../types";
import { complete, isAiAvailable, type ChatMessage } from "../../bridge/ai";
import { todayISO } from "../diary";
import { applyAdjustment, parseAdjustment, type PlanAdjustment } from "../plan/analyze";
import { validateProgram } from "../plan/validate";
import { saveProgram } from "../plan/planService";
import { renderMemory } from "./context";
import { remember } from "./memory";
import type {
  CheckinKind,
  CoachAnswer,
  CoachContext,
  CoachEventKind,
  CoachMetric,
  CoachOutcome,
} from "./model";

const ADJUSTMENT_SHAPE = `{ "summary": string, "deload"?: boolean, "benchmarkTargetDelta"?: number,
  "changes": [ { "op": "setReps"|"setWeight"|"setRest"|"swap", "exerciseKey": string, "reps"?: number, "weightKg"?: number, "restSec"?: number, "toName"?: string } ] }`;

const EVAL_SYSTEM = `You are the user's wellness coach inside their fitness app. Friendly, brief, specific — never a doctor.
They just answered a short check-in. Reply with ONLY a JSON object:
  { "reply": string,
    "notes": string[],
    "summary": string,
    "adjustment": ${ADJUSTMENT_SHAPE} | null }
Rules:
- "reply": 1-3 encouraging sentences reacting to THEIR answers and history. Reference specifics (a PR, a trend, their words). No generic filler.
- "notes": 0-3 SHORT durable facts worth remembering long-term (preferences, constraints, recurring struggles). Empty array if none.
- "summary": one paragraph (<80 words) updating the running summary of their journey, folding in today.
- "adjustment": null unless their answers CLEARLY warrant a small program tweak (e.g. everything too hard -> ease off; too easy -> nudge up). Prefer null. "exerciseKey" must be a key from the program exercises listed in the context. Keep changes tiny and safe.
- Output ONLY the JSON. No prose, no markdown fences.`;

const CHAT_SYSTEM_BASE = `You are the user's personal trainer + nutrition coach inside their fitness app ("Conjure Health"). Warm, direct, practical. You are NOT a doctor — for pain, injury, or medical questions, advise seeing a professional.
You can see their real data (plan, food, weight, workouts, check-ins, past plans) and your own memory of them — use it; reference specifics instead of generic advice.
You CAN update their workout program when they ask for a change (or clearly need one): include, anywhere in your reply, a single block of the form
<adjust>${ADJUSTMENT_SHAPE}</adjust>
using ONLY exerciseKeys listed in the context. The app validates and applies it, so keep changes small and safe; never mention the tag itself. Calorie/goal targets are edited in Settings — point them there for those.
Keep replies short (2-5 sentences) unless they ask for detail.`;

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

/**
 * Apply a coach-proposed adjustment through the same rails as the adaptation
 * engine. Returns the persisted plan, or null when there's no program, the
 * adjustment is empty, or validation fails (no-op).
 */
async function applyToPlan(plan: Plan | null, adj: PlanAdjustment): Promise<Plan | null> {
  if (!plan?.program) return null;
  if (adj.changes.length === 0 && !adj.deload && adj.benchmarkTargetDelta == null) return null;
  const candidate = applyAdjustment(plan.program, adj);
  const reasons = validateProgram(candidate, plan.mode, plan.safety.injuries ?? []);
  if (reasons.length > 0) return null;
  return saveProgram(plan, candidate);
}

const metricsFrom = (answers: CoachAnswer[]): CoachMetric[] => {
  const now = new Date().toISOString();
  const date = todayISO();
  return answers
    .filter((a): a is CoachAnswer & { scale: number; metricKey: string } => a.scale != null && a.metricKey != null)
    .map((a) => ({ at: now, date, key: a.metricKey, value: a.scale }));
};

const answersBlock = (answers: CoachAnswer[]): string =>
  answers.map((a) => `Q: ${a.question}\nA: ${a.value}`).join("\n");

/**
 * Evaluate a submitted check-in (post-workout or end-of-day): coach reply,
 * memory update (notes/summary/event/metrics), and an optional validated plan
 * tweak. Never throws; without an AI bridge the check-in is still recorded.
 */
export async function evaluateCheckin(
  kind: CheckinKind,
  answers: CoachAnswer[],
  ctx: CoachContext,
): Promise<CoachOutcome> {
  const eventKind: CoachEventKind = kind === "workout" ? "workout_reflect" : "day_checkin";
  const at = new Date().toISOString();
  const eventText = answers.map((a) => `${a.question} → ${a.value}`).join(" · ");
  const metrics = metricsFrom(answers);

  if (!isAiAvailable()) {
    await remember({ events: [{ at, kind: eventKind, text: eventText }], metrics });
    return { reply: "Logged — thanks for checking in. Keep it up!" };
  }

  try {
    const raw = await complete({
      system: EVAL_SYSTEM,
      messages: [
        {
          role: "user",
          content: `CONTEXT\n${ctx.rendered}\n\nCOACH MEMORY\n${renderMemory(ctx)}\n\nCHECK-IN (${kind})\n${answersBlock(answers)}`,
        },
      ],
      maxTokens: 1024,
      tier: "capable",
    });
    const o = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
    const reply =
      typeof o.reply === "string" && o.reply.trim() ? o.reply.trim() : "Logged — thanks for checking in.";
    const notes = Array.isArray(o.notes) ? o.notes.filter((n): n is string => typeof n === "string") : [];
    const summary = typeof o.summary === "string" ? o.summary : undefined;

    let planUpdate: CoachOutcome["planUpdate"];
    if (o.adjustment && typeof o.adjustment === "object") {
      const adj = parseAdjustment(JSON.stringify(o.adjustment));
      if (adj) {
        const updated = await applyToPlan(ctx.plan, adj);
        if (updated) planUpdate = { plan: updated, summary: adj.summary };
      }
    }

    await remember({
      notes,
      summary,
      metrics,
      events: [
        { at, kind: eventKind, text: eventText },
        ...(planUpdate ? [{ at, kind: "plan_adjusted" as const, text: planUpdate.summary }] : []),
      ],
    });
    return { reply, planUpdate };
  } catch {
    await remember({ events: [{ at, kind: eventKind, text: eventText }], metrics });
    return { reply: "Logged — thanks for checking in. Keep it up!" };
  }
}

/**
 * One free-form chat turn with the trainer. `history` includes the user's
 * newest message last. A returned <adjust> block is applied through the
 * validated path and replaced with a confirmation line in the reply.
 */
export async function coachChat(history: ChatMessage[], ctx: CoachContext): Promise<CoachOutcome> {
  if (!isAiAvailable()) {
    return {
      reply:
        "Your coach needs the ConjureOS AI service, which isn't available right now — try again inside ConjureOS.",
    };
  }
  const system = `${CHAT_SYSTEM_BASE}\n\nCONTEXT\n${ctx.rendered}\n\nCOACH MEMORY\n${renderMemory(ctx)}`;
  const raw = await complete({ system, messages: history.slice(-16), maxTokens: 1024, tier: "capable" });

  const match = raw.match(/<adjust>([\s\S]*?)<\/adjust>/);
  let reply = raw.replace(/<adjust>[\s\S]*?<\/adjust>/g, "").trim();
  let planUpdate: CoachOutcome["planUpdate"];
  if (match?.[1]) {
    const adj = parseAdjustment(match[1]);
    const updated = adj ? await applyToPlan(ctx.plan, adj) : null;
    if (updated && adj) {
      planUpdate = { plan: updated, summary: adj.summary };
      await remember({
        events: [{ at: new Date().toISOString(), kind: "plan_adjusted", text: adj.summary }],
      });
      reply = reply ? `${reply}\n\n✓ Plan updated: ${adj.summary}` : `✓ Plan updated: ${adj.summary}`;
    } else if (adj) {
      reply = reply || "I couldn't apply that change safely, so I left your plan as-is.";
    }
  }
  return { reply: reply || "…", planUpdate };
}
