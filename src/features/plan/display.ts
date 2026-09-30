/**
 * How a plan's mode reads to the user.
 */

import type { Plan } from "../../types";

const MODE_LABEL: Record<Plan["mode"], string> = {
  get_fit: "Get fit",
  // The safety gate's plan: habits and check-ins, no prescribed workouts.
  logging_only: "Habits only",
};

/** Mode label as the plan should read. */
export function planModeLabel(plan: Plan): string {
  return MODE_LABEL[plan.mode] ?? plan.mode;
}
