/**
 * Pure draft transforms + save rules for ProgramEditor, split out so they can be
 * unit-tested without a DOM.
 */

import type { PlanMode, WorkoutProgram } from "../types";
import { normalizeExerciseKey } from "../features/explainers/normalizeKey";
import { validateProgram } from "../features/plan/validate";

/**
 * Rename the benchmark at `bi` AND every workout exercise sharing its old key.
 * The key is the join between a benchmark and the exercise that measures it
 * (WorkoutRunner records results under normalizeExerciseKey(exerciseName)), so
 * renaming one side alone means the benchmark is never measured again. Reads
 * the old key from the draft it is given, so it is safe to call per keystroke.
 */
export function renameBenchmark(d: WorkoutProgram, bi: number, name: string): WorkoutProgram {
  const old = d.benchmarks[bi];
  if (!old) return d;
  return renameKeyed(d, old.exerciseKey, name);
}

/**
 * Rename one exercise. When it is the exercise its workout uses to measure a
 * benchmark (the workout is linked to a benchmark whose key matches the
 * exercise's current key), the benchmark and any other exercise sharing that key
 * follow the new name; otherwise only this exercise changes.
 */
export function renameExercise(d: WorkoutProgram, wi: number, ei: number, name: string): WorkoutProgram {
  const pw = d.workouts[wi];
  const ex = pw?.workout.exercises[ei];
  if (!pw || !ex) return d;
  const oldKey = normalizeExerciseKey(ex.name);
  const linked = new Set<string>([...(pw.benchmarkIds ?? []), ...(pw.benchmarkId != null ? [pw.benchmarkId] : [])]);
  if (d.benchmarks.some((b) => linked.has(b.id) && b.exerciseKey === oldKey)) {
    return renameKeyed(d, oldKey, name);
  }
  return {
    ...d,
    workouts: d.workouts.map((w, i) =>
      i === wi
        ? { ...w, workout: { ...w.workout, exercises: w.workout.exercises.map((e, j) => (j === ei ? { ...e, name } : e)) } }
        : w,
    ),
  };
}

function renameKeyed(d: WorkoutProgram, oldKey: string, name: string): WorkoutProgram {
  return {
    ...d,
    benchmarks: d.benchmarks.map((b) =>
      b.exerciseKey === oldKey ? { ...b, name, exerciseKey: normalizeExerciseKey(name) } : b,
    ),
    workouts: d.workouts.map((pw) => ({
      ...pw,
      workout: {
        ...pw.workout,
        exercises: pw.workout.exercises.map((e) => (normalizeExerciseKey(e.name) === oldKey ? { ...e, name } : e)),
      },
    })),
  };
}

/**
 * Reasons an edited program can't be saved: the shared safety rails plus the
 * editor-only rule that an assessment (benchmark) workout must remain. Without
 * one the Plan tab's evaluation gate has nothing to start and dead-ends.
 * (Kept out of validateProgram: group progression validates a partial program
 * of training clones that legitimately has no benchmark workout.)
 */
export function editorSaveReasons(draft: WorkoutProgram, mode: PlanMode, injuries: string[]): string[] {
  const reasons = validateProgram(draft, mode, injuries);
  if (draft.workouts.length > 0 && !draft.workouts.some((pw) => pw.isBenchmark)) {
    reasons.push("program needs an assessment (benchmark) workout");
  }
  return reasons;
}
