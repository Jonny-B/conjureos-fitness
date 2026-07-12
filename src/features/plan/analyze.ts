/**
 * Post-workout adaptation engine (W5) — the AI half of the adaptive loop.
 *
 * Periodically (every N logged sessions) we summarize recent actuals — slow
 * sets, RPE, and benchmark stagnation — and ask the model for a SMALL, bounded
 * adjustment to the program (rep/weight/rest tweaks, a movement swap, a
 * benchmark target nudge, or a deload). The adjustment is applied to a COPY of
 * the program and re-validated against the exact same safety rails a generated
 * program clears; if anything fails to parse or validate, we make NO change —
 * a valid plan is never degraded by a bad adaptation.
 *
 * Mirrors generate.ts (one `complete` call, extract-json, strict parse) and is
 * deterministic in its trigger (session-count cursor, no scheduler).
 */

import type { Plan, WorkoutProgram, WorkoutSession } from "../../types";
import { complete } from "../../bridge/ai";
import { normalizeExerciseKey } from "../explainers/normalizeKey";
import { validateProgram } from "./validate";

/** How many new sessions between adaptation passes. */
export const ANALYSIS_INTERVAL = 3;
/** How many recent sessions to summarize for the model. */
const RECENT_WINDOW = 6;

type ChangeOp = "setReps" | "setWeight" | "setRest" | "swap";

interface ProgramChange {
  op: ChangeOp;
  /** Normalized key of the exercise to change. */
  exerciseKey: string;
  reps?: number;
  weightKg?: number;
  restSec?: number;
  /** New movement name for a swap. */
  toName?: string;
}

interface PlanAdjustment {
  /** One-line human summary of what changed and why. */
  summary: string;
  changes: ProgramChange[];
  /** Lighten the load this cycle (recovery). */
  deload?: boolean;
  /** Add to (or subtract from) the benchmark target. */
  benchmarkTargetDelta?: number;
}

const SYSTEM = `You are a wellness coach adjusting an existing workout program from recent performance data. You are NOT a doctor.
Return ONLY a JSON object describing a SMALL, safe adjustment:
  { "summary": string,
    "deload"?: boolean,
    "benchmarkTargetDelta"?: number,
    "changes": [ { "op": "setReps"|"setWeight"|"setRest"|"swap", "exerciseKey": string, "reps"?: number, "weightKg"?: number, "restSec"?: number, "toName"?: string } ] }
Rules:
- Make at most 4 changes. Prefer the smallest nudge that helps.
- If sets were fast/easy or RPE was low and the benchmark is progressing, add a little (a rep, a small weight bump, or a modest benchmarkTargetDelta > 0).
- If sets were slow, RPE was high, or the benchmark has stalled/regressed, ease off (fewer reps, less weight, more rest) or set "deload": true; you may lower the benchmark target (benchmarkTargetDelta < 0).
- "exerciseKey" MUST be one of the keys listed in the data. Never invent an exercise. A "swap" keeps the same body area and stays equipment-light.
- weightKg is in kilograms. Keep everything beginner-safe.
- Output ONLY the JSON. No prose, no markdown fences.`;

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

const OPS = new Set<ChangeOp>(["setReps", "setWeight", "setRest", "swap"]);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function parseAdjustment(raw: string): PlanAdjustment | null {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const rawChanges = Array.isArray(o.changes) ? o.changes : [];
  const changes: ProgramChange[] = [];
  for (const c of rawChanges.slice(0, 4)) {
    if (!c || typeof c !== "object") continue;
    const co = c as Record<string, unknown>;
    if (!OPS.has(co.op as ChangeOp)) continue;
    const exerciseKey = typeof co.exerciseKey === "string" ? co.exerciseKey.trim() : "";
    if (!exerciseKey) continue;
    const change: ProgramChange = { op: co.op as ChangeOp, exerciseKey };
    if (co.reps != null) change.reps = num(co.reps);
    if (co.weightKg != null) change.weightKg = num(co.weightKg);
    if (co.restSec != null) change.restSec = num(co.restSec);
    if (typeof co.toName === "string") change.toName = co.toName.trim().slice(0, 80);
    changes.push(change);
  }
  const delta = num(o.benchmarkTargetDelta);
  return {
    summary: typeof o.summary === "string" ? o.summary.trim().slice(0, 200) : "Adjusted your plan",
    changes,
    ...(o.deload === true ? { deload: true } : {}),
    ...(delta != null && delta !== 0 ? { benchmarkTargetDelta: delta } : {}),
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Apply a parsed adjustment to a COPY of the program. Pure — never mutates the
 * input. Unknown exercise keys are ignored; the benchmark movement can't be
 * swapped away (that would break the loop).
 */
export function applyAdjustment(program: WorkoutProgram, adj: PlanAdjustment): WorkoutProgram {
  const benchKeys = new Set(program.benchmarks.map((b) => b.exerciseKey));

  const workouts = program.workouts.map((pw) => {
    const exercises = pw.workout.exercises.map((ex) => {
      const key = normalizeExerciseKey(ex.name);
      const applicable = adj.changes.filter((c) => c.exerciseKey === key);
      if (applicable.length === 0 && !adj.deload) return ex;
      let sets = ex.sets.map((s) => ({ ...s }));
      let name = ex.name;
      for (const c of applicable) {
        if (c.op === "setReps" && c.reps != null) {
          const r = clamp(Math.round(c.reps), 1, 100);
          sets = sets.map((s) => (s.reps != null ? { ...s, reps: r } : s));
        } else if (c.op === "setWeight" && c.weightKg != null) {
          const w = clamp(c.weightKg, 0, 500);
          sets = sets.map((s) => ({ ...s, weightKg: w > 0 ? w : undefined }));
        } else if (c.op === "setRest" && c.restSec != null) {
          const rest = clamp(Math.round(c.restSec), 0, 600);
          sets = sets.map((s) => ({ ...s, restSec: rest }));
        } else if (c.op === "swap" && c.toName && !benchKeys.has(key)) {
          name = c.toName;
        }
      }
      // Deload: shave ~10% off any loaded set (recovery week).
      if (adj.deload) {
        sets = sets.map((s) =>
          s.weightKg != null ? { ...s, weightKg: Math.round(s.weightKg * 0.9 * 10) / 10 } : s,
        );
      }
      return { ...ex, name, sets };
    });
    return { ...pw, workout: { ...pw.workout, exercises } };
  });

  // Benchmark target nudge — keep it positive; preserve baseline/history.
  const benchmarks =
    adj.benchmarkTargetDelta != null
      ? program.benchmarks.map((b) => ({
          ...b,
          target: Math.max(0.1, Math.round((b.target + adj.benchmarkTargetDelta!) * 10) / 10),
        }))
      : program.benchmarks;

  return { ...program, workouts, benchmarks };
}

function fmtSet(s: { reps?: number; weightKg?: number; durationSec?: number; rpe?: number; startedAt: string; completedAt: string }): string {
  const parts: string[] = [];
  if (s.reps != null) parts.push(`${s.reps} reps`);
  if (s.weightKg != null) parts.push(`${s.weightKg} kg`);
  if (s.durationSec != null) parts.push(`${s.durationSec}s`);
  const elapsed = (Date.parse(s.completedAt) - Date.parse(s.startedAt)) / 1000;
  if (Number.isFinite(elapsed) && elapsed > 0) parts.push(`took ${Math.round(elapsed)}s`);
  if (s.rpe != null) parts.push(`RPE ${s.rpe}`);
  return parts.join(", ");
}

/** Summarize the program + recent actuals + benchmark trend for the model. */
export function buildAnalysisPrompt(program: WorkoutProgram, sessions: WorkoutSession[]): string {
  const lines: string[] = [];

  const keys = new Set<string>();
  for (const pw of program.workouts) {
    for (const ex of pw.workout.exercises) keys.add(normalizeExerciseKey(ex.name));
  }
  lines.push(`Program exercises (use these exact keys): ${[...keys].join(", ") || "(none)"}.`);

  const b = program.benchmarks[0];
  if (b) {
    const hist = b.history.map((h) => h.value);
    lines.push(
      `Benchmark: ${b.name} (key ${b.exerciseKey}), metric ${b.metric}, unit ${b.unit}, baseline ${b.baseline ?? "unset"}, target ${b.target}${b.lowerIsBetter ? " (lower is better)" : ""}. History: ${hist.length ? hist.join(" -> ") : "none yet"}.`,
    );
  }

  const recent = sessions.slice(0, RECENT_WINDOW);
  lines.push(`\nRecent sessions (newest first, ${recent.length}):`);
  for (const s of recent) {
    if (s.cardio) {
      lines.push(`- ${s.date}: cardio ${s.cardio.distanceKm.toFixed(2)} km in ${Math.round(s.cardio.durationSec / 60)} min.`);
      continue;
    }
    const exLines = (s.byExercise ?? []).map(
      (e) => `  · ${e.name} (${e.exerciseKey}): ${e.sets.map(fmtSet).join(" | ")}`,
    );
    lines.push(`- ${s.date}:`);
    lines.push(...(exLines.length ? exLines : ["  · (no recorded sets)"]));
  }

  return lines.join("\n");
}

/** Whether an adaptation pass is due (>= interval new sessions since last run). */
export function shouldAnalyze(program: WorkoutProgram, sessionCount: number): boolean {
  return sessionCount - (program.analysisCursor ?? 0) >= ANALYSIS_INTERVAL;
}

/**
 * Run one adaptation pass over a plan: analyze recent sessions, apply a bounded
 * adjustment, RE-VALIDATE, and return an updated Plan — or the same plan with
 * only its `analysisCursor` advanced when the model errors, the adjustment is
 * unparseable, or the result fails validation (strict no-op on the program).
 * The caller persists whatever comes back.
 */
export async function analyzeAndAdapt(plan: Plan, sessions: WorkoutSession[]): Promise<Plan> {
  const program = plan.program;
  if (!program) return plan;

  // Always advance the cursor so the next pass waits another interval, even if
  // this one changes nothing.
  const cursored: WorkoutProgram = { ...program, analysisCursor: sessions.length };
  const withCursor: Plan = { ...plan, program: cursored };

  let adjusted: WorkoutProgram | null = null;
  try {
    const raw = await complete({
      system: SYSTEM,
      messages: [{ role: "user", content: buildAnalysisPrompt(program, sessions) }],
      maxTokens: 1024,
      tier: "capable",
    });
    const adj = parseAdjustment(raw);
    if (adj && (adj.changes.length > 0 || adj.deload || adj.benchmarkTargetDelta != null)) {
      const candidate = applyAdjustment(cursored, adj);
      const reasons = validateProgram(candidate, plan.mode, plan.safety.injuries ?? []);
      if (reasons.length === 0) adjusted = candidate;
    }
  } catch {
    /* transport error — no-op adjustment, cursor still advances */
  }

  return adjusted ? { ...plan, program: adjusted } : withCursor;
}

/**
 * Trigger + run: if an adaptation is due, run it; otherwise return null (no
 * change). Keeps the "periodic" policy in one place for the caller.
 */
export async function maybeAdapt(plan: Plan, sessions: WorkoutSession[]): Promise<Plan | null> {
  if (!plan.program) return null;
  if (!shouldAnalyze(plan.program, sessions.length)) return null;
  return analyzeAndAdapt(plan, sessions);
}
