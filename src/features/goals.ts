/**
 * Goal recommendation — Mifflin-St Jeor BMR × activity → TDEE, adjusted for
 * the user's direction (lose/maintain/gain), then split into macro grams.
 *
 * These are recommendations only; the user can override any number in
 * settings. Deliberately simple and transparent (no body-fat models, no
 * adaptive TDEE) — accuracy beyond ±10% isn't meaningful for goal-setting.
 */

import type { ActivityLevel, GoalDirection, Goals, Profile } from "../types";

const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary (little/no exercise)",
  light: "Light (1–3 days/week)",
  moderate: "Moderate (3–5 days/week)",
  active: "Active (6–7 days/week)",
  very_active: "Very active (hard daily training)",
};

/** Calorie delta per day for each direction (~0.5 kg/week ≈ 500 kcal). */
const DIRECTION_DELTA: Record<GoalDirection, number> = {
  lose: -500,
  maintain: 0,
  gain: 300,
};

export function bmrMifflin(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === "male" ? base + 5 : base - 161;
}

export function tdee(p: Profile): number {
  return bmrMifflin(p) * ACTIVITY_MULTIPLIER[p.activityLevel];
}

/**
 * Recommend goals from a profile. Calories = TDEE + direction delta, floored
 * at a safe minimum. Macros: protein 1.6 g/kg bodyweight, fat 25% of calories,
 * carbs fill the remainder — a sane, widely-used default split.
 */
export function recommendGoals(p: Profile): Goals {
  const minCalories = p.sex === "male" ? 1500 : 1200;
  const calories = Math.max(minCalories, Math.round(tdee(p) + DIRECTION_DELTA[p.direction]));

  const protein = Math.round(1.6 * p.weightKg);
  const fat = Math.round((calories * 0.25) / 9);
  const carbsCalories = calories - protein * 4 - fat * 9;
  const carbs = Math.max(0, Math.round(carbsCalories / 4));

  return { calories, protein, carbs, fat };
}

/** BMI from the profile's current weight + height. */
export function bmi(p: Profile): number {
  const m = p.heightCm / 100;
  if (m <= 0) return 0;
  return Math.round((p.weightKg / (m * m)) * 10) / 10;
}
