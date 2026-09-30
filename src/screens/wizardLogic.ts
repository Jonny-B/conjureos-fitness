/**
 * Pure helpers behind WizardScreen's state seeding, validation and commit, kept
 * out of the component so they run under vitest's node environment (no jsdom).
 */
import type { ActivityLevel, AgeBand, ExperienceLevel, Plan, Profile } from "../types";
import { daysPerWeekForActivity } from "../features/activity";
import type { WizardBody } from "../features/plan/planService";

export const DAYS_OPTIONS = [2, 3, 4, 5, 6] as const;

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

/**
 * Age is always required. A workout plan also needs bodyweight (calorie-burn
 * estimates read it); a gated plan prescribes no workouts, so it doesn't.
 */
export function wizardInputsValid(v: {
  age: number | undefined;
  hasWorkouts: boolean;
  weightKg: number | undefined;
}): boolean {
  // A blank age must never pass: it would be read as an adult (skipping the
  // under-18 gate) and overwrite the stored age.
  if (v.age == null) return false;
  return !v.hasWorkouts || v.weightKg != null;
}

/** The body stats to reconcile into the profile on commit. */
export function buildWizardBody(v: {
  hasWorkouts: boolean;
  sex: Profile["sex"];
  weightKg: number | undefined;
  age: number | undefined;
  ageBand: AgeBand;
  activityLevel: ActivityLevel;
  experienceLevel: ExperienceLevel;
  units: Profile["units"];
}): WizardBody {
  return {
    sex: v.hasWorkouts ? v.sex : undefined,
    weightKg: v.hasWorkouts ? v.weightKg : undefined,
    age: v.age,
    ageBand: v.ageBand,
    activityLevel: v.activityLevel,
    experienceLevel: v.hasWorkouts ? v.experienceLevel : undefined,
    units: v.units,
  };
}

/** Copy for the safety-gate notice. Fitness tracks no food, so it must not
 *  promise any. */
export const GATED_NOTICE =
  "Based on your answers we won't prescribe workouts. Talk to your doctor before adding exercise.";

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
