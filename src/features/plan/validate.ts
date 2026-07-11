/**
 * Post-generation plan validator (P2 / safety layer 4). Runs on the AI's plan
 * before it can be saved. Enforces three rails from the design:
 *   1. Kcal floor — a food-tracking plan's daily target can't dip below the
 *      sex-specific floor (1200 F / 1500 M / 1500 default).
 *   2. Injury exclusion — no workout goal may name a movement excluded by a
 *      declared injury region (reuses the P1 exclusion map).
 *   3. Intensity cap — no absurd number of workout goals.
 * A failing plan is retried once, then replaced by a fallback template.
 */

import type { PlanMode, SafetyIntake, Sex } from "../../types";
import type { GeneratedPlan } from "./model";
import { kcalFloor, modeHasWorkouts, modeTracksFood } from "./model";
import { isExerciseExcluded } from "../safety/injuryExclusions";

const MAX_WORKOUT_GOALS = 6;

export interface ValidationContext {
  mode: PlanMode;
  sex?: Sex;
  safety: SafetyIntake;
}

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

export function validatePlan(gen: GeneratedPlan, ctx: ValidationContext): ValidationResult {
  const reasons: string[] = [];

  // 1. Kcal floor (only for modes that actually track food).
  if (modeTracksFood(ctx.mode)) {
    const floor = kcalFloor(ctx.sex);
    if (gen.dailyCalorieTarget == null) {
      reasons.push("food-tracking plan has no daily calorie target");
    } else if (gen.dailyCalorieTarget < floor) {
      reasons.push(`calorie target ${gen.dailyCalorieTarget} is below the ${floor} kcal floor`);
    }
  }

  // 2. Injury-region exclusion on every workout goal.
  const injuries = ctx.safety.injuries ?? [];
  for (const g of gen.goals) {
    if (g.kind !== "workout") continue;
    const text = `${g.label} ${g.detail ?? ""}`;
    if (isExerciseExcluded(text, injuries)) {
      reasons.push(`workout "${g.label}" conflicts with a declared injury`);
    }
  }

  // 3. Intensity cap.
  const workoutGoals = gen.goals.filter((g) => g.kind === "workout").length;
  if (workoutGoals > MAX_WORKOUT_GOALS) {
    reasons.push(`too many workout goals (${workoutGoals} > ${MAX_WORKOUT_GOALS})`);
  }

  // 4. Mode/gate consistency: a food-only or logging-only plan (e.g. the
  // under-18 / pregnancy / cardiac gate) must never prescribe exercise.
  if (!modeHasWorkouts(ctx.mode) && workoutGoals > 0) {
    reasons.push(`a ${ctx.mode} plan must not prescribe workouts`);
  }

  return { ok: reasons.length === 0, reasons };
}
