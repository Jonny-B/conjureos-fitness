/**
 * Intermediate shapes for plan generation (P2). The wizard collects a
 * `PlanInput`; the AI (or a fallback template) produces a `GeneratedPlan`; the
 * validator checks it; then it's assembled into the persisted domain `Plan`
 * (src/types.ts). Kept separate from the domain model so generate/validate/
 * fallback can share these without importing each other.
 */

import type {
  ExperienceLevel,
  PlanGoal,
  PlanMode,
  SafetyIntake,
  WorkoutProgram,
} from "../../types";

/** Everything the wizard gathers before generating a plan. */
export interface PlanInput {
  mode: PlanMode;
  /** Free-text goal, e.g. "run a 5K without stopping". */
  goalText: string;
  /** Plan length in weeks (derived from the start/end dates). */
  durationWeeks: number;
  /** Inclusive plan dates (YYYY-MM-DD); start defaults to today. */
  startDate?: string;
  endDate?: string;
  /** Workout days per week. */
  daysPerWeek?: number;
  /** Training background — tunes workout difficulty. */
  experienceLevel?: ExperienceLevel;
  /** Equipment on hand, free text or "none". */
  equipment?: string;
  /** The user's display-unit preference. Storage stays metric; this only tells
   *  the generator to write user-facing TEXT (summary, goal labels, workout
   *  descriptions) in the units the user actually reads. */
  units?: "metric" | "imperial";
  safety: SafetyIntake;
}

/** One goal as emitted by generation, before it becomes a PlanGoal (+ id). */
export interface GeneratedGoal {
  label: string;
  kind: PlanGoal["kind"];
  /** Machine hint, e.g. the movements for a workout goal. */
  detail?: string;
}

/** The raw plan a generator (AI or template) produces, pre-validation. */
export interface GeneratedPlan {
  /** One-line framing shown on the review step. */
  summary: string;
  goals: GeneratedGoal[];
  /** Structured, adaptive workout program. Parsed from the AI's `program`
   *  block for a get_fit plan; absent otherwise. Baselines start null. */
  program?: WorkoutProgram;
}

/** Whether this mode prescribes workouts: false for the safety gate's logging_only plan. */
export function modeHasWorkouts(mode: PlanMode): boolean {
  return mode === "get_fit";
}
