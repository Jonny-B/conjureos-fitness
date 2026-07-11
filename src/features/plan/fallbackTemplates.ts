/**
 * Safety layer 4 (last resort) — three hardcoded, known-safe plan templates,
 * one per real mode. Used when AI generation fails validation twice (or the
 * estimator is unreachable). Every template is intensity-capped, above the
 * kcal floor, and equipment-free, so it can never trip the validator. The
 * logging-only mode doesn't need a template — it's just the diary — but we
 * return a minimal food-logging plan for it so the shape is always valid.
 */

import type { PlanMode } from "../../types";
import type { GeneratedPlan, PlanInput } from "./model";
import { modeTracksFood } from "./model";
import { isExerciseExcluded } from "../safety/injuryExclusions";

/** A generous, always-safe daily calorie target (well above every floor). */
const SAFE_KCAL = 1800;

const TEMPLATES: Record<PlanMode, GeneratedPlan> = {
  eat_better: {
    summary: "A gentle 'eat better' plan: steady calories, more protein and produce, no crash dieting.",
    dailyCalorieTarget: SAFE_KCAL,
    goals: [
      { label: `Stay around ${SAFE_KCAL} kcal`, kind: "nutrition", detail: String(SAFE_KCAL) },
      { label: "Protein at every meal", kind: "nutrition" },
      { label: "Two servings of vegetables", kind: "habit" },
      { label: "A glass of water before each meal", kind: "habit" },
    ],
  },
  get_fit: {
    summary: "A beginner-friendly 'get fit' plan: short bodyweight sessions and daily movement, no equipment.",
    dailyCalorieTarget: null,
    goals: [
      { label: "15-minute bodyweight session", kind: "workout", detail: "marching, wall push-ups, sit-to-stand, gentle stretching" },
      { label: "A brisk 20-minute walk", kind: "workout", detail: "walking" },
      { label: "Stand and stretch every hour", kind: "habit" },
    ],
  },
  both: {
    summary: "A balanced 'both' plan: sensible calories plus short, equipment-free movement.",
    dailyCalorieTarget: SAFE_KCAL,
    goals: [
      { label: `Stay around ${SAFE_KCAL} kcal`, kind: "nutrition", detail: String(SAFE_KCAL) },
      { label: "Protein at every meal", kind: "nutrition" },
      { label: "15-minute bodyweight session", kind: "workout", detail: "marching, wall push-ups, sit-to-stand, gentle stretching" },
      { label: "A brisk 20-minute walk", kind: "workout", detail: "walking" },
    ],
  },
  logging_only: {
    summary: "Just tracking for now: log your food and weight, no plan pressure.",
    dailyCalorieTarget: SAFE_KCAL,
    goals: [
      { label: "Log everything you eat", kind: "nutrition" },
      { label: "A weekly weigh-in", kind: "habit" },
    ],
  },
};

/**
 * The safe template for a mode. Adjusts the calorie target down only for modes
 * that don't track food (null), never below the safe value otherwise. `input`
 * is accepted for future personalisation but the template is intentionally
 * generic — its whole job is to be unconditionally safe.
 */
export function fallbackPlan(mode: PlanMode, input?: PlanInput): GeneratedPlan {
  const t = TEMPLATES[mode] ?? TEMPLATES.logging_only;
  const injuries = input?.safety?.injuries ?? [];
  // The fallback isn't re-validated, so it must be safe by construction: drop
  // any workout goal a declared injury excludes.
  let goals = t.goals.filter(
    (g) => g.kind !== "workout" || !isExerciseExcluded(`${g.label} ${g.detail ?? ""}`, injuries),
  );
  if (goals.length === 0) {
    goals = [{ label: "Log everything you eat", kind: "nutrition" }];
  }
  return {
    summary: t.summary,
    dailyCalorieTarget: modeTracksFood(mode) ? t.dailyCalorieTarget : null,
    goals: goals.map((g) => ({ ...g })),
  };
}
