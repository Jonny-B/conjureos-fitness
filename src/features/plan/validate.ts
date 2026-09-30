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

import type { PlanMode, SafetyIntake, Sex, WorkoutProgram } from "../../types";
import type { GeneratedGoal, GeneratedPlan } from "./model";
import { kcalFloor, modeHasWorkouts, modeTracksFood } from "./model";
import { isExerciseExcluded } from "../safety/injuryExclusions";

const MAX_WORKOUT_GOALS = 6;
const MAX_PROGRAM_WORKOUTS = 6;
const MAX_BENCHMARKS = 4;

/**
 * Exercise wording, matched on word boundaries (so "brunch" and "brown rice"
 * don't hit the way a raw substring match would). The model's `kind` label is
 * not trusted for the safety gates: a "go for a run" goal labelled "habit" is
 * still exercise. Deliberately not `inferKind`, which tests nutrition words
 * first and so calls "burn fat with sprints" a nutrition goal.
 */
const WORKOUT_WORDS =
  /\b(workouts?|exercis(?:e|es|ing)|runs?|running|jog(?:s|ging)?|walk(?:s|ing)?|bik(?:e|es|ing)|cycling|lift(?:s|ing)?|deadlifts?|squats?|lunges?|burpees?|sprint(?:s|ing)?|hiit|cardio|strength|train(?:s|ing)?|planks?|push-?ups?|pull-?ups?|sit-?ups?|swim(?:s|ming)?|yoga|pilates|gym|\d+k|miles?)\b/i;

/** A goal counts as exercise by its model label OR by what its text says. */
function isWorkoutGoal(g: GeneratedGoal): boolean {
  return g.kind === "workout" || WORKOUT_WORDS.test(`${g.label} ${g.detail ?? ""}`);
}

/**
 * Program-only safety rails (W4/W5). Returns a list of reasons the program is
 * unsafe/invalid; empty means it passes. Shared by full plan validation and the
 * adaptation engine so an AI-adjusted program clears the exact same gate a
 * generated one does.
 */
export function validateProgram(
  program: WorkoutProgram,
  mode: PlanMode,
  injuries: string[],
): string[] {
  const reasons: string[] = [];
  if (!modeHasWorkouts(mode)) {
    reasons.push(`a ${mode} plan must not carry a workout program`);
  }
  // The workout cap applies PER GROUP: a program retains the current group plus
  // the evaluation/training templates it clones the next group from, so the
  // flat total can legitimately exceed one group's worth. (Local derivation of
  // a workout's group — groups.ts imports this module, so no import cycle.)
  const groupNums = new Map<number, number>();
  for (const pw of program.workouts) {
    const g = pw.group ?? (pw.isBenchmark ? 1 : 2);
    groupNums.set(g, (groupNums.get(g) ?? 0) + 1);
  }
  if (program.workouts.length < 1) {
    reasons.push("program has no workouts");
  }
  for (const [g, count] of groupNums) {
    if (count > MAX_PROGRAM_WORKOUTS) {
      reasons.push(`group ${g} has ${count} workouts (max ${MAX_PROGRAM_WORKOUTS})`);
    }
  }
  for (const pw of program.workouts) {
    const w = pw.workout;
    const isCardio = w.kind === "run" || w.kind === "bike";
    // Cardio workouts carry no exercises, so the name (and a run's kind) is all
    // there is to check. The description is free text and the patterns are bare
    // substrings ("row" in "grow"), so it is deliberately left out.
    if (isExerciseExcluded(`${w.name} ${w.kind === "run" ? "run" : ""}`, injuries)) {
      reasons.push(`program workout "${w.name}" conflicts with a declared injury`);
    }
    // A strength workout with no sets builds zero player steps (a blank screen).
    if (!isCardio) {
      if (w.exercises.length === 0) {
        reasons.push(`workout "${w.name}" has no exercises`);
      }
      for (const e of w.exercises) {
        if (e.sets.length === 0) {
          reasons.push(`workout "${w.name}" exercise "${e.name}" has no sets`);
        }
      }
    }
    for (const e of w.exercises) {
      if (isExerciseExcluded(`${e.name} ${e.notes ?? ""}`, injuries)) {
        reasons.push(`program exercise "${e.name}" conflicts with a declared injury`);
      }
    }
  }
  // 1–4 benchmarks: a single keystone effort, or a small multi-part assessment
  // (e.g. Murph = pull-ups + push-ups + run). More than 4 is noise, zero leaves
  // the adaptive loop with nothing to track.
  if (program.benchmarks.length < 1 || program.benchmarks.length > MAX_BENCHMARKS) {
    reasons.push(`program must have 1-${MAX_BENCHMARKS} benchmarks (found ${program.benchmarks.length})`);
  }
  for (const b of program.benchmarks) {
    if (!Number.isFinite(b.target) || b.target <= 0) {
      reasons.push(`benchmark "${b.name}" has no valid target`);
    }
    if (isExerciseExcluded(b.name, injuries)) {
      reasons.push(`benchmark "${b.name}" conflicts with a declared injury`);
    }
  }
  return reasons;
}

/** What a generated plan must be checked against: the plan's mode plus the
 *  user's safety intake (age band, flags, injuries). */
export interface ValidationContext {
  mode: PlanMode;
  sex?: Sex;
  safety: SafetyIntake;
}

/** Outcome of a safety check. `reasons` is empty when `ok`, and otherwise
 *  lists every violation — it feeds the AI re-prompt, so it stays specific. */
export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Safety-check an AI-generated plan before it can be shown or stored.
 *
 * This is the gate, not a warning: a plan that fails here is regenerated or
 * replaced by the fallback template, never surfaced. Checks the calorie floor
 * for food-tracking modes, injury-excluded movements, and per-session volume.
 */
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

  // 2. Injury-region exclusion on every workout goal (by its text, not just its
  // model-supplied kind).
  const injuries = ctx.safety.injuries ?? [];
  for (const g of gen.goals) {
    if (!isWorkoutGoal(g)) continue;
    const text = `${g.label} ${g.detail ?? ""}`;
    if (isExerciseExcluded(text, injuries)) {
      reasons.push(`workout "${g.label}" conflicts with a declared injury`);
    }
  }

  // 3. Intensity cap.
  const workoutGoals = gen.goals.filter(isWorkoutGoal).length;
  if (workoutGoals > MAX_WORKOUT_GOALS) {
    reasons.push(`too many workout goals (${workoutGoals} > ${MAX_WORKOUT_GOALS})`);
  }

  // 4. Mode/gate consistency: a food-only or logging-only plan (e.g. the
  // under-18 / pregnancy / cardiac gate) must never prescribe exercise.
  if (!modeHasWorkouts(ctx.mode) && workoutGoals > 0) {
    reasons.push(`a ${ctx.mode} plan must not prescribe workouts`);
  }

  // 5. Structured workout program (W4), when present.
  if (gen.program) {
    reasons.push(...validateProgram(gen.program, ctx.mode, injuries));
  }

  return { ok: reasons.length === 0, reasons };
}
