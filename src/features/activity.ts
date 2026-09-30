/**
 * Day-to-day activity level ⇄ planned training days per week. The wizard asks
 * how many days a week the user wants to train and stores the activity level
 * that implies, so plans from before the days were stored can still reopen on
 * a sensible number.
 */

import type { ActivityLevel } from "../types";

/**
 * Activity level DERIVED from planned workout days per week — the wizard
 * doesn't ask both ("how active are you" duplicated "how often will you
 * train"). Coarse on purpose.
 */
export function activityForDaysPerWeek(days: number): ActivityLevel {
  if (days <= 2) return "light";
  if (days <= 4) return "moderate";
  if (days === 5) return "active";
  return "very_active";
}

/**
 * Inverse of `activityForDaysPerWeek`: a representative days/week that maps back
 * to the given activity level. Seeds the plan editor's days chip for a plan
 * that doesn't store its own days (see Plan.weeklyExerciseDays).
 */
export function daysPerWeekForActivity(activity: ActivityLevel): number {
  switch (activity) {
    case "very_active":
      return 6;
    case "active":
      return 5;
    case "moderate":
      return 3;
    default:
      return 2; // light / sedentary
  }
}
