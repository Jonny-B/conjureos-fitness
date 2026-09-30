/**
 * Pure helpers behind WizardScreen's state seeding, validation and commit, kept
 * out of the component so they run under vitest's node environment (no jsdom).
 */
import type { ActivityLevel, AgeBand, ExperienceLevel, GoalDirection, Plan, PlanMode, Profile } from "../types";
import { daysPerWeekForActivity } from "../features/goals";
import type { WizardBody } from "../features/plan/planService";

export const DAYS_OPTIONS = [2, 3, 4, 5, 6] as const;

/**
 * The mode the wizard opens an edit on. A stored logging_only plan is NOT
 * carried over: it was forced by the safety intake (there is no picker for it),
 * so the intake, seeded from the plan, re-derives it through resolveSafeMode.
 * Carrying it over made it permanent even after the flags were corrected.
 */
export function seedWizardMode(
  existing: PlanMode | undefined,
  flags: { coachAndWorkouts: boolean; nutrition: boolean },
): PlanMode {
  if (!flags.coachAndWorkouts) return "eat_better";
  // Food tracking off: every plan is a training plan (see features/flags).
  if (!flags.nutrition) return "get_fit";
  return existing === "logging_only" || !existing ? "both" : existing;
}

/** Safety answers prefilled from the plan being edited (none when creating, and
 *  tolerant of legacy plans with no safety object). */
export function seedSafety(editPlan: Plan | null | undefined): {
  pregnant: boolean;
  cardiacFlag: boolean;
  injuries: string[];
} {
  return {
    pregnant: editPlan?.safety?.pregnant ?? false,
    cardiacFlag: editPlan?.safety?.cardiacFlag ?? false,
    injuries: [...(editPlan?.safety?.injuries ?? [])],
  };
}

/** Days-per-week chip seed: the days stored on the plan first (a 4 survives),
 *  else the inverse of the profile's activity (old plans), else 3. */
export function seedDaysPerWeek(
  editPlan: Plan | null | undefined,
  profile: Profile | null | undefined,
  editMode: boolean,
): number {
  const stored = editPlan?.weeklyExerciseDays;
  if (stored != null && (DAYS_OPTIONS as readonly number[]).includes(stored)) return stored;
  return editMode && profile ? daysPerWeekForActivity(profile.activityLevel) : 3;
}

/** The plan's weekly-days target: the training days for a workout plan, else
 *  the "move most days" chip (0 = not tracking). */
export function goalDaysFor(hasWorkouts: boolean, daysPerWeek: number, weeklyExerciseDays: number): number {
  return hasWorkouts ? daysPerWeek : weeklyExerciseDays;
}

/** Whether the wizard collects body stats: food plans need them for calories,
 *  workout plans need bodyweight for calorie-burn estimates. */
export function wizardNeedsBody(tracksFood: boolean, hasWorkouts: boolean): boolean {
  return tracksFood || hasWorkouts;
}

export function wizardInputsValid(v: {
  age: number | undefined;
  tracksFood: boolean;
  hasWorkouts: boolean;
  heightCm: number | undefined;
  weightKg: number | undefined;
}): boolean {
  // A blank age must never pass: it would be read as an adult (skipping the
  // under-18 gate) and overwrite the stored age.
  if (v.age == null) return false;
  if (!wizardNeedsBody(v.tracksFood, v.hasWorkouts)) return true;
  return v.weightKg != null && (!v.tracksFood || v.heightCm != null);
}

/** The body stats to reconcile into the profile on commit. */
export function buildWizardBody(v: {
  tracksFood: boolean;
  hasWorkouts: boolean;
  sex: Profile["sex"];
  heightCm: number | undefined;
  weightKg: number | undefined;
  goalWeightKg: number | undefined;
  direction: GoalDirection;
  age: number | undefined;
  ageBand: AgeBand;
  activityLevel: ActivityLevel;
  experienceLevel: ExperienceLevel;
  units: Profile["units"];
}): WizardBody {
  const needsBody = wizardNeedsBody(v.tracksFood, v.hasWorkouts);
  return {
    sex: needsBody ? v.sex : undefined,
    heightCm: needsBody ? v.heightCm : undefined,
    weightKg: needsBody ? v.weightKg : undefined,
    goalWeightKg: v.tracksFood && v.direction !== "maintain" ? v.goalWeightKg : undefined,
    age: v.age,
    ageBand: v.ageBand,
    activityLevel: v.activityLevel,
    experienceLevel: v.hasWorkouts ? v.experienceLevel : undefined,
    direction: v.tracksFood ? v.direction : undefined,
    units: v.units,
  };
}

/** Copy for the safety-gate notice. Fitness has no food tracking, so it must
 *  not promise any. */
export function gatedNoticeCopy(flags: { coachAndWorkouts: boolean; nutrition: boolean }): string {
  if (!flags.nutrition) {
    return "Based on your answers we won't prescribe workouts. Talk to your doctor before adding exercise.";
  }
  return flags.coachAndWorkouts
    ? "Based on your answers we'll keep this to food & habit tracking, with no workout prescriptions. You can always talk to your doctor about adding exercise."
    : "Based on your answers we'll keep this to food & habit tracking. Talk to your doctor before adding exercise.";
}

/**
 * Wrap a commit so a second tap while the first is still running is ignored
 * (the commit archives the outgoing plan, so running twice duplicates it). The
 * guard releases when the commit settles, so a failed commit can be retried.
 */
export function createCommitGuard(onBusy?: (busy: boolean) => void) {
  let busy = false;
  return (fn: () => void | Promise<void>): void => {
    if (busy) return;
    busy = true;
    onBusy?.(true);
    void Promise.resolve()
      .then(fn)
      .catch((err) => {
        // Release the guard (finally) so the user can retry; keep the failure
        // visible in the console rather than an unhandled rejection.
        console.warn("[conjure-fitness] plan commit failed", err);
      })
      .finally(() => {
        busy = false;
        onBusy?.(false);
      });
  };
}
