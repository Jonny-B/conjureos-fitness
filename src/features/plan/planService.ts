/**
 * Plan service — the single API surface for the active plan.
 *
 * Everything that reads or writes a plan goes through here: the wizard (create
 * and edit), the program editor, and the workouts screen
 * (post-session adaptation). Screens never call `getRepository()` for plan ops
 * or hand-spread `{ ...plan }` inline anymore — that glue lived in three places
 * and drifted. This module also reconciles the plan with the Profile, so body
 * stats aren't entered twice.
 *
 * A write that fails is reported through `persist` (logged, and the user is
 * told) and the returned in-memory plan stays authoritative for the session.
 */

import type { AgeBand, Plan, PlanGoal, Profile, WorkoutProgram, WorkoutSession } from "../../types";
import { DEFAULT_PROFILE } from "../../types";
import { getRepository } from "../../data/repository";
import { persist } from "../../data/saveFailure";
import { newId } from "../../data/id";
import { todayISO } from "../dates";
import { measureSession, recordBenchmarkResult } from "./program";
import { calibrateToBenchmark, maybeAdapt } from "./analyze";
import { advanceToNextGroup, setWorkoutDone } from "./groups";
import { loadMemory, summarizeMemoryForProgram } from "../coach/memory";

/** Body stats the wizard collects, reconciled into the Profile on commit. */
export interface WizardBody {
  sex?: Profile["sex"];
  weightKg?: number;
  /** Exact age (preferred); ageBand is the coarse fallback. */
  age?: number;
  ageBand?: AgeBand;
  activityLevel?: Profile["activityLevel"];
  experienceLevel?: Profile["experienceLevel"];
  units?: Profile["units"];
}

/** Coarse age bands → a representative age when only the band is known. */
const AGE_FOR_BAND: Record<AgeBand, number> = {
  under_18: 16,
  "18_39": 28,
  "40_59": 50,
  "60_plus": 68,
};

/** Load the active plan, or null (a failed read is treated as no plan). */
export async function loadPlan(): Promise<Plan | null> {
  const repo = await getRepository();
  return repo.getPlan().catch(() => null);
}

/** What a plan commit produced. Both are already persisted; they're returned
 *  so the caller can update React state without re-reading. */
export interface CommitResult {
  plan: Plan;
  profile: Profile | null;
}

/**
 * Merge the wizard's body stats onto a profile (each field falls back to the
 * base when the wizard didn't collect it). Shared by plan creation and in-place
 * plan edits so both reconcile the profile identically. Storage stays metric —
 * the wizard's `PlanFields` already convert display→kg before we get here.
 */
export function mergeBodyIntoProfile(base: Profile, b: WizardBody): Profile {
  return {
    ...base,
    sex: b.sex ?? base.sex,
    weightKg: b.weightKg ?? base.weightKg,
    // Prefer the exact age; fall back to the age-band's representative age.
    age: b.age ?? (b.ageBand ? AGE_FOR_BAND[b.ageBand] : base.age),
    activityLevel: b.activityLevel ?? base.activityLevel,
    experienceLevel: b.experienceLevel ?? base.experienceLevel,
    units: b.units ?? base.units,
  };
}

/**
 * Persist a newly-created plan and merge the wizard's body stats into the
 * Profile, so the user never re-enters them.
 */
export async function commitNewPlan(
  plan: Plan,
  ctx: { body?: WizardBody; currentProfile: Profile | null },
): Promise<CommitResult> {
  const repo = await getRepository();
  // Seed the adaptation cursor with the sessions already logged, so a new plan
  // waits for its OWN first few sessions instead of adapting off old history.
  if (plan.program) {
    const logged = await repo.listWorkoutSessions().catch(() => [] as WorkoutSession[]);
    plan = { ...plan, program: { ...plan.program, analysisCursor: logged.length } };
  }
  await persist("your plan", repo.savePlan(plan));

  // The caller's profile is a cached copy: consent (and anything else written
  // straight to the store since) may have moved on. Build on what is stored.
  const stored = await repo.getProfile().catch(() => null);
  const current = stored ?? ctx.currentProfile;
  let profile = current;
  const b = ctx.body;
  if (b && (b.weightKg != null || b.sex != null || b.age != null)) {
    profile = mergeBodyIntoProfile(current ?? DEFAULT_PROFILE, b);
  }
  // ALWAYS persist a profile once a plan exists — never leave store.json.profile
  // null. A null profile makes the cog fall back to DEFAULT_PROFILE (and older
  // code could then cement those defaults), which reads as "my stats reverted to
  // default" after a reload. Fall back to the current profile, else DEFAULT.
  const finalProfile: Profile = profile ?? { ...DEFAULT_PROFILE };
  await persist("your profile", repo.saveProfile(finalProfile));
  profile = finalProfile;
  return { plan, profile };
}

/** Persist a program edit. (ProgramEditor validates before calling this.) */
export async function saveProgram(plan: Plan, program: WorkoutProgram): Promise<Plan> {
  const next: Plan = { ...plan, program };
  const repo = await getRepository();
  await persist("your plan", repo.savePlan(next));
  return next;
}

/** The plan fields an edit may change. Deliberately excludes `program` and
 *  `id`, so patching can never drop group progress or benchmark history. */
export interface PlanPatch {
  mode?: Plan["mode"];
  /** Weekly exercise-days target; 0 clears it (see Plan.weeklyExerciseDays). */
  weeklyExerciseDays?: number;
  goals?: PlanGoal[];
  startDate?: string;
  endDate?: string;
  durationWeeks?: number;
}

const PLAN_ARCHIVE_PATH = "plan-archive.json";

/**
 * Archive the outgoing plan so history/insight survives a "start a new plan"
 * reset. Keeps the 20 most recent, newest first.
 *
 * Workout-session history lives in a separate store and is never touched here. Best-effort: a failed write is swallowed rather than
 * blocking the new plan.
 */
export async function archivePlan(plan: Plan): Promise<void> {
  try {
    const { readJsonStrict, writeJson } = await import("../../bridge/vfs");
    // Strict: an unreadable archive must skip the write, not replace the
    // history with just this plan.
    const prev = await readJsonStrict<Plan[]>(PLAN_ARCHIVE_PATH, []);
    const next = [{ ...plan }, ...prev].slice(0, 20);
    await writeJson(PLAN_ARCHIVE_PATH, next);
  } catch {
    /* archiving is best-effort */
  }
}

/** Patch the plan and persist it. */
export async function updatePlan(plan: Plan, patch: PlanPatch): Promise<Plan> {
  const next: Plan = { ...plan, ...patch };
  const repo = await getRepository();
  await persist("your plan", repo.savePlan(next));
  return next;
}

// ── Editing an existing plan: new vs modify-in-place ───────────────────

/** The wizard answers that decide whether an edit forks a new plan. */
export interface PlanEditAnswers {
  mode: Plan["mode"];
  goalText: string;
  startDate: string;
}

/** What an edit does: fork a brand-new plan (archiving the old one) or patch
 *  the existing one in place, keeping its id, groups, and benchmarks. */
export type PlanEditDecision = "new" | "modify";

const normGoal = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Decide whether editing a plan should regenerate a brand-new plan or modify
 * the existing one in place. Owner-locked trigger: a change to the GOAL TEXT,
 * the MODE, or the START DATE means the plan itself is different → new plan
 * (archive + regenerate workouts). Everything else (end date, experience,
 * days/week, equipment, bodyweight) is a tune of the same plan → modify in
 * place, keeping the plan id + program/group progress.
 *
 * A plan with no stored `goalText` (made with the box blank, or before it was
 * persisted) counts as having an empty goal, so typing one later forks a new
 * plan instead of being silently dropped by the in-place edit.
 */
export function decidePlanEdit(plan: Plan, next: PlanEditAnswers): PlanEditDecision {
  if (next.mode !== plan.mode) return "new";
  if (next.startDate !== plan.startDate) return "new";
  if (normGoal(next.goalText) !== normGoal(plan.goalText ?? "")) return "new";
  return "modify";
}

/**
 * Modify the active plan in place from an edit that didn't change its identity.
 * Keeps the plan id, the workout program (group progress, benchmark history,
 * every `completedAt`), and the plan goals, and re-merges body stats into the
 * profile.
 */
export async function modifyPlanInPlace(
  plan: Plan,
  body: WizardBody,
  patch: { endDate?: string; durationWeeks?: number; weeklyExerciseDays?: number },
  ctx: { currentProfile: Profile | null },
): Promise<CommitResult> {
  const repo = await getRepository();
  // Build on the stored profile, not the caller's cached copy (see commitNewPlan).
  const stored = await repo.getProfile().catch(() => null);
  const profile = mergeBodyIntoProfile(stored ?? ctx.currentProfile ?? DEFAULT_PROFILE, body);
  await persist("your profile", repo.saveProfile(profile));
  // Patch intentionally omits program / goals / mode → updatePlan's spread
  // preserves them, so group progress and benchmark history survive untouched.
  const next = await updatePlan(plan, patch);
  return { plan: next, profile };
}

/** Drop the active plan. */
export async function clearPlan(): Promise<void> {
  const repo = await getRepository();
  await persist("that change to your plan", repo.clearPlan());
}

/**
 * Persist a finished session, then run the adaptive loop: fold any benchmark
 * result into the program (measurement), then — every N sessions — let the AI
 * propose a bounded, re-validated adjustment (adaptation). The plan is saved at
 * most once. Returns the (possibly updated) plan for the caller to set in state.
 */
export async function recordSessionAndAdapt(
  plan: Plan | null,
  session: WorkoutSession,
  opts?: {
    /** The ProgramWorkout this session fulfilled — checks it off in its group. */
    programWorkoutId?: string;
  },
): Promise<Plan | null> {
  const repo = await getRepository();
  // persist already told the user; throw so the caller stops (no reflection, no
  // check-off for a session that was never stored) and can retry. Saving is
  // idempotent by session id.
  if (!(await persist("this workout", repo.saveWorkoutSession(session)))) {
    throw new Error("workout not saved");
  }
  if (!plan?.program) return plan;

  const measuresBenchmark = Boolean(session.benchmarkId || session.benchmarkIds?.length);

  let next: Plan = plan;
  if (opts?.programWorkoutId) {
    const done = setWorkoutDone(plan.program, opts.programWorkoutId, true, session.completedAt);
    if (done !== plan.program) next = { ...plan, program: done };
  }
  let baselineJustSet = false;
  if (measuresBenchmark) {
    const before = next.program!;
    const program = recordBenchmarkResult(before, session);
    if (program !== before) {
      next = { ...next, program };
      // A benchmark whose baseline flipped null → value this fold-in means the
      // user just did their first assessment — time to calibrate the program.
      // (recordBenchmarkResult preserves benchmark order, so indexes align.)
      baselineJustSet = before.benchmarks.some(
        (b, i) => b.baseline == null && program.benchmarks[i]?.baseline != null,
      );
    }
  }

  try {
    // The FULL list: its length is the lifetime count the adaptation cursor
    // compares against (the prompt only reads the newest few).
    const sessions = await repo.listWorkoutSessions();
    // Feed the coach's memory of the user (stated dislikes/constraints + recent
    // reflections) into the program engine so adaptation honors their feedback.
    const prefs = await coachPreferences();
    if (baselineJustSet) {
      // Benchmark-first: the assessment just set the baselines, so tune the
      // provisional workouts to the measured capacity before the periodic loop.
      next = await calibrateToBenchmark(next, sessions, prefs);
    } else {
      const adapted = await maybeAdapt(next, sessions, prefs);
      if (adapted) next = adapted;
    }
  } catch {
    /* AI/adaptation is best-effort; keep the measurement result */
  }

  if (next !== plan) await persist("your plan", repo.savePlan(next));
  return next;
}

/** Manually toggle a program workout's done state (skipped workouts shouldn't
 *  wedge the group) and persist. Returns the updated plan. */
export async function toggleWorkoutDone(plan: Plan, programWorkoutId: string, done: boolean): Promise<Plan> {
  if (!plan.program) return plan;
  const program = setWorkoutDone(plan.program, programWorkoutId, done);
  if (program === plan.program) return plan;
  const next: Plan = { ...plan, program };
  const repo = await getRepository();
  await persist("your plan", repo.savePlan(next));
  return next;
}

/** Advance to the next group (generating it when needed) and persist. The next
 *  group's progression is shaped by recorded stats AND the coach's memory of the
 *  user's feedback/preferences. */
export async function startNextGroup(plan: Plan): Promise<Plan> {
  const repo = await getRepository();
  const sessions = await repo.listWorkoutSessions(200).catch(() => [] as WorkoutSession[]);
  const next = await advanceToNextGroup(plan, sessions, await coachPreferences());
  if (next !== plan) await persist("your plan", repo.savePlan(next));
  return next;
}

/** The coach-memory feedback block for the program engine, or "" if none/error. */
async function coachPreferences(): Promise<string> {
  try {
    return summarizeMemoryForProgram(await loadMemory());
  } catch {
    return "";
  }
}

/** A plan-level change the coach can apply from chat (ask-first, like program
 *  tweaks): a new end date, to extend or shorten the plan. */
export interface CoachPlanChange {
  summary: string;
  /** New plan end date, YYYY-MM-DD. */
  endDate: string;
}

const weeksBetweenIso = (start: string, end: string): number => {
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) ? Math.min(52, Math.max(1, Math.round(ms / (7 * 86400000)))) : 1;
};

/**
 * Apply a coach-proposed PLAN-LEVEL change — the confirmation-gated counterpart
 * to program tweaks. Returns the updated plan, or null when nothing valid
 * changed.
 */
export async function applyCoachPlanChange(
  plan: Plan | null,
  change: CoachPlanChange,
): Promise<{ plan: Plan } | null> {
  if (!plan) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(change.endDate) || change.endDate <= plan.startDate) return null;
  if (change.endDate === plan.endDate) return null;
  const next = await updatePlan(plan, {
    endDate: change.endDate,
    durationWeeks: weeksBetweenIso(plan.startDate, change.endDate),
  });
  return { plan: next };
}

/** One manually-entered benchmark result: the Benchmark id + the value in the
 *  benchmark's STORAGE metric (reps / kg / seconds / km). */
export interface ManualBenchmarkEntry {
  benchmarkId: string;
  value: number;
}

/**
 * Record an evaluation's results WITHOUT running the workout — an experienced
 * lifter often already knows their numbers. Builds a synthetic session carrying
 * each entered value in the shape `measureSession` reads (strength values as a
 * recorded set on the benchmark's exercise key; run/ride results as a cardio
 * block), then routes it through the exact same fold-in + calibration path a
 * performed assessment takes, checking the evaluation workout off its group.
 */
export async function recordManualBenchmarkEntry(
  plan: Plan,
  programWorkoutId: string,
  entries: ManualBenchmarkEntry[],
): Promise<Plan | null> {
  const program = plan.program;
  if (!program || entries.length === 0) return plan;
  const now = new Date().toISOString();
  const stamp = { startedAt: now, completedAt: now };

  const byExercise: NonNullable<WorkoutSession["byExercise"]> = [];
  let cardio: WorkoutSession["cardio"];
  const benchmarkIds: string[] = [];

  for (const e of entries) {
    const b = program.benchmarks.find((x) => x.id === e.benchmarkId);
    if (!b || !Number.isFinite(e.value) || e.value <= 0) continue;
    benchmarkIds.push(b.id);
    if (b.metric === "distanceKm") {
      cardio = { distanceKm: e.value, durationSec: cardio?.durationSec ?? 0, source: "manual" };
    } else if (b.metric === "durationSec" && isCardioBenchmark(b.exerciseKey)) {
      cardio = { distanceKm: cardio?.distanceKm ?? 0, durationSec: e.value, source: "manual" };
    } else {
      const set =
        b.metric === "weightKg"
          ? { weightKg: e.value, ...stamp }
          : b.metric === "durationSec"
            ? { durationSec: Math.round(e.value), ...stamp }
            : { reps: Math.round(e.value), ...stamp };
      byExercise.push({ exerciseKey: b.exerciseKey, name: b.name, sets: [set] });
    }
  }
  if (benchmarkIds.length === 0) return plan;

  const session: WorkoutSession = {
    id: newId(),
    date: todayISO(),
    // Recalled numbers, not a workout done today: saved for the program, but
    // kept out of the cross-app workout list and training summary.
    source: "benchmark_entry",
    planned: [],
    actual: [],
    reprompts: [],
    ...(byExercise.length ? { byExercise } : {}),
    ...(cardio ? { cardio } : {}),
    benchmarkIds,
    completedAt: now,
  };
  // Sanity: every entered benchmark must actually be measurable off this
  // session; drop silently-unmeasurable ones rather than recording a no-op.
  const measurable = program.benchmarks.some(
    (b) => benchmarkIds.includes(b.id) && measureSession(b, session) != null,
  );
  if (!measurable) return plan;

  return recordSessionAndAdapt(plan, session, { programWorkoutId });
}

/** Heuristic: a benchmark keyed to a run/ride/row-style movement records its
 *  time as a cardio result rather than a timed strength set. */
function isCardioBenchmark(exerciseKey: string): boolean {
  return /\b(run|jog|sprint|bike|cycle|cycling|row|rowing|swim|walk|ruck)\b/.test(exerciseKey);
}
