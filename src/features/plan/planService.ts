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
import { recordBenchmarkResult } from "./program";
import { maybeAdapt } from "./analyze";

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
    await repo.saveProfile(profile).catch(() => {});
  }

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
): Promise<Plan | null> {
  const repo = await getRepository();
  await repo.saveWorkoutSession(session).catch(() => {});
  if (!plan?.program) return plan;

  let next: Plan = plan;
  if (session.benchmarkId) {
    const program = recordBenchmarkResult(plan.program, session);
    if (program !== plan.program) next = { ...plan, program };
  }

  try {
    const sessions = await repo.listWorkoutSessions(200);
    const adapted = await maybeAdapt(next, sessions);
    if (adapted) next = adapted;
  } catch {
    /* AI/adaptation is best-effort; keep the measurement result */
  }

  if (next !== plan) await repo.savePlan(next).catch(() => {});
  return next;
}
