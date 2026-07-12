/**
 * Safety layer 4 (last resort) — three hardcoded, known-safe plan templates,
 * one per real mode. Used when AI generation fails validation twice (or the
 * estimator is unreachable). Every template is intensity-capped, above the
 * kcal floor, and equipment-free, so it can never trip the validator. The
 * logging-only mode doesn't need a template — it's just the diary — but we
 * return a minimal food-logging plan for it so the shape is always valid.
 */

import type { Exercise, PlanMode, WorkoutProgram } from "../../types";
import type { GeneratedPlan, PlanInput } from "./model";
import { modeHasWorkouts, modeTracksFood } from "./model";
import { isExerciseExcluded } from "../safety/injuryExclusions";
import { newId } from "../../data/id";
import { normalizeExerciseKey } from "../explainers/normalizeKey";

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
 * A known-safe bodyweight benchmark program for the workout modes. Every move
 * is equipment-free and beginner-appropriate; any exercise a declared injury
 * excludes is dropped, and if the benchmark effort itself is excluded (or no
 * exercises survive) the program is omitted entirely — a plan is still valid
 * without one.
 */
function fallbackProgram(mode: PlanMode, injuries: string[]): WorkoutProgram | undefined {
  if (!modeHasWorkouts(mode)) return undefined;

  const seed: { name: string; sets: Exercise["sets"]; notes?: string }[] = [
    { name: "Sit-to-Stand", sets: [{ reps: 12, durationSec: null, restSec: 45 }], notes: "Stand from a chair, control the way down." },
    { name: "Wall Push-ups", sets: [{ reps: 10, durationSec: null, restSec: 45 }], notes: "Hands on a wall, chest to wall." },
    { name: "March in Place", sets: [{ reps: null, durationSec: 60, restSec: 30 }], notes: "Lift the knees, easy pace." },
    { name: "Plank", sets: [{ reps: null, durationSec: 30, restSec: 45 }], notes: "Neutral spine, squeeze the glutes." },
  ];
  const exercises: Exercise[] = seed
    .filter((s) => !isExerciseExcluded(`${s.name} ${s.notes ?? ""}`, injuries))
    .map((s) => ({ id: newId(), name: s.name, sets: s.sets, ...(s.notes ? { notes: s.notes } : {}) }));
  if (exercises.length === 0) return undefined;

  // Benchmark the first surviving rep-based exercise; require it to be safe.
  const benchEx = exercises.find((e) => e.sets.some((set) => set.reps != null));
  if (!benchEx || isExerciseExcluded(benchEx.name, injuries)) return undefined;

  const benchmarkId = newId();
  return {
    workouts: [
      {
        id: newId(),
        workout: { id: newId(), name: "Bodyweight Starter", summary: "Equipment-free full-body", exercises, origin: "built-in" },
        isBenchmark: true,
        benchmarkId,
      },
    ],
    benchmarks: [
      {
        id: benchmarkId,
        exerciseKey: normalizeExerciseKey(benchEx.name),
        name: benchEx.name,
        metric: "reps",
        baseline: null,
        target: 20,
        unit: "reps",
        history: [],
      },
    ],
    analysisCursor: 0,
  };
}

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
  const program = fallbackProgram(mode, injuries);
  return {
    summary: t.summary,
    dailyCalorieTarget: modeTracksFood(mode) ? t.dailyCalorieTarget : null,
    goals: goals.map((g) => ({ ...g })),
    ...(program ? { program } : {}),
  };
}
