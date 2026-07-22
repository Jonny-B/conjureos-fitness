/**
 * Plan service — the single API surface for the active plan.
 *
 * Everything that reads or writes a plan goes through here: the wizard (create),
 * the settings editor (mode / targets / program edits), and the workouts screen
 * (post-session adaptation). Screens never call `getRepository()` for plan ops
 * or hand-spread `{ ...plan }` inline anymore — that glue lived in three places
 * and drifted. This module also owns the reconciliation between the three
 * previously-disjoint stores (Plan ↔ Profile ↔ Goals) so a plan actually
 * informs the diary and body stats aren't entered twice.
 *
 * Persistence tolerates the Supabase `PLAN_REQUIRES_V2_BACKEND` throw (plan data
 * is VFS-only today) exactly as the old call sites did — every write is
 * best-effort and the returned in-memory plan is authoritative for the session.
 */

import type {
  AgeBand,
  Goals,
  Plan,
  PlanGoal,
  PlanTargets,
  Profile,
  WorkoutProgram,
  WorkoutSession,
} from "../../types";
import { DEFAULT_PROFILE } from "../../types";
import { getRepository } from "../../data/repository";
import { newId } from "../../data/id";
import { measureSession, recordBenchmarkResult } from "./program";
import { calibrateToBenchmark, maybeAdapt } from "./analyze";
import { advanceToNextGroup, setWorkoutDone } from "./groups";

/** Body stats the wizard collects, reconciled into the Profile on commit. */
export interface WizardBody {
  sex?: Profile["sex"];
  heightCm?: number;
  weightKg?: number;
  goalWeightKg?: number;
  /** Exact age (preferred); ageBand is the coarse fallback. */
  age?: number;
  ageBand?: AgeBand;
  activityLevel?: Profile["activityLevel"];
  experienceLevel?: Profile["experienceLevel"];
  direction?: Profile["direction"];
  units?: Profile["units"];
}

/** Coarse age bands → a representative age for Mifflin-based recompute later. */
const AGE_FOR_BAND: Record<AgeBand, number> = {
  under_18: 16,
  "18_39": 28,
  "40_59": 50,
  "60_plus": 68,
};

/** Load the active plan, or null (Supabase throws → treated as no plan). */
export async function loadPlan(): Promise<Plan | null> {
  const repo = await getRepository();
  return repo.getPlan().catch(() => null);
}

/**
 * The effective daily targets the diary should show: the plan's targets when it
 * tracks food, else the separately-stored Goals. Missing macros fall back to
 * the stored ones so a plan that only pinned calories still shows sane macros.
 */
export function targetsToGoals(plan: Plan | null, stored: Goals): Goals {
  const t = plan?.targets;
  if (t && t.dailyCalories != null) {
    return {
      calories: t.dailyCalories,
      protein: t.protein ?? stored.protein,
      carbs: t.carbs ?? stored.carbs,
      fat: t.fat ?? stored.fat,
    };
  }
  return stored;
}

/** Build PlanTargets from an explicit Goals object (settings edits). */
export function goalsToTargets(goals: Goals): PlanTargets {
  return {
    dailyCalories: goals.calories,
    protein: goals.protein,
    carbs: goals.carbs,
    fat: goals.fat,
  };
}

export interface CommitResult {
  plan: Plan;
  profile: Profile | null;
  goals: Goals;
}

/**
 * Persist a newly-created plan and reconcile the other two stores:
 *  - merge the wizard's body stats into the Profile (so Trends/BMI work and the
 *    user never re-enters height/weight in settings), and
 *  - project the plan's targets into stored Goals (so the diary rings match even
 *    on code paths that read Goals directly).
 */
export async function commitNewPlan(
  plan: Plan,
  ctx: { body?: WizardBody; currentProfile: Profile | null; currentGoals: Goals },
): Promise<CommitResult> {
  const repo = await getRepository();
  await repo.savePlan(plan).catch(() => {});

  let profile = ctx.currentProfile;
  const b = ctx.body;
  if (b && (b.heightCm != null || b.weightKg != null || b.sex != null || b.age != null)) {
    const base = ctx.currentProfile ?? DEFAULT_PROFILE;
    profile = {
      ...base,
      sex: b.sex ?? base.sex,
      heightCm: b.heightCm ?? base.heightCm,
      weightKg: b.weightKg ?? base.weightKg,
      goalWeightKg: b.goalWeightKg ?? base.goalWeightKg,
      // Prefer the exact age; fall back to the age-band's representative age.
      age: b.age ?? (b.ageBand ? AGE_FOR_BAND[b.ageBand] : base.age),
      activityLevel: b.activityLevel ?? base.activityLevel,
      experienceLevel: b.experienceLevel ?? base.experienceLevel,
      direction: b.direction ?? base.direction,
      units: b.units ?? base.units,
    };
  }
  // ALWAYS persist a profile once a plan exists — never leave store.json.profile
  // null. A null profile makes the cog fall back to DEFAULT_PROFILE (and older
  // code could then cement those defaults), which reads as "my stats reverted to
  // default" after a reload. Fall back to the current profile, else DEFAULT.
  const finalProfile: Profile = profile ?? { ...DEFAULT_PROFILE };
  await repo.saveProfile(finalProfile).catch(() => {});
  profile = finalProfile;

  const goals = targetsToGoals(plan, ctx.currentGoals);
  if (plan.targets?.dailyCalories != null) {
    await repo.saveGoals(goals).catch(() => {});
  }
  return { plan, profile, goals };
}

/** Persist a program edit. (ProgramEditor validates before calling this.) */
export async function saveProgram(plan: Plan, program: WorkoutProgram): Promise<Plan> {
  const next: Plan = { ...plan, program };
  const repo = await getRepository();
  await repo.savePlan(next).catch(() => {});
  return next;
}

export interface PlanPatch {
  mode?: Plan["mode"];
  goals?: PlanGoal[];
  targets?: PlanTargets;
  startDate?: string;
  endDate?: string;
  durationWeeks?: number;
}

/** Archive the outgoing plan so history/insight survives a "start a new plan"
 *  reset. Diary/weight/workout-session history live in separate stores and are
 *  never touched here. */
const PLAN_ARCHIVE_PATH = "plan-archive.json";
export async function archivePlan(plan: Plan): Promise<void> {
  try {
    const { readJson, writeJson } = await import("../../bridge/vfs");
    const prev = await readJson<Plan[]>(PLAN_ARCHIVE_PATH, []);
    const next = [{ ...plan }, ...prev].slice(0, 20);
    await writeJson(PLAN_ARCHIVE_PATH, next);
  } catch {
    /* archiving is best-effort */
  }
}

/**
 * Patch the plan (mode / plan-goals / targets) from the settings editor, persist
 * it, and re-project targets into stored Goals when they changed.
 */
export async function updatePlan(
  plan: Plan,
  patch: PlanPatch,
  ctx: { currentGoals: Goals },
): Promise<{ plan: Plan; goals: Goals }> {
  const next: Plan = { ...plan, ...patch };
  const repo = await getRepository();
  await repo.savePlan(next).catch(() => {});
  const goals = targetsToGoals(next, ctx.currentGoals);
  if (patch.targets && next.targets?.dailyCalories != null) {
    await repo.saveGoals(goals).catch(() => {});
  }
  return { plan: next, goals };
}

/** Drop the active plan. */
export async function clearPlan(): Promise<void> {
  const repo = await getRepository();
  await repo.clearPlan().catch(() => {});
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
  await repo.saveWorkoutSession(session).catch(() => {});
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
    const sessions = await repo.listWorkoutSessions(200);
    if (baselineJustSet) {
      // Benchmark-first: the assessment just set the baselines, so tune the
      // provisional workouts to the measured capacity before the periodic loop.
      next = await calibrateToBenchmark(next, sessions);
    } else {
      const adapted = await maybeAdapt(next, sessions);
      if (adapted) next = adapted;
    }
  } catch {
    /* AI/adaptation is best-effort; keep the measurement result */
  }

  if (next !== plan) await repo.savePlan(next).catch(() => {});
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
  await repo.savePlan(next).catch(() => {});
  return next;
}

/** Advance to the next group (generating it when needed) and persist. */
export async function startNextGroup(plan: Plan): Promise<Plan> {
  const repo = await getRepository();
  const sessions = await repo.listWorkoutSessions(200).catch(() => [] as WorkoutSession[]);
  const next = await advanceToNextGroup(plan, sessions);
  if (next !== plan) await repo.savePlan(next).catch(() => {});
  return next;
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
    date: now.slice(0, 10),
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
