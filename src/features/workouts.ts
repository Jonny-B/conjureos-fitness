/**
 * Workout library + player sequencing.
 *
 * v1 ships a small built-in library (no persistence) so the guided player —
 * the part with real value: set timers, rest timers, audio cues — is usable
 * immediately. Saved/custom workouts and exercise history are the next slice
 * and would route through the repository like the diary does.
 */

import type { Exercise, Workout } from "../types";

let n = 0;
const id = () => `seed-${n++}`;

function repSet(reps: number, restSec: number, weightKg?: number) {
  return { reps, durationSec: null, restSec, ...(weightKg ? { weightKg } : {}) };
}
function timedSet(durationSec: number, restSec: number) {
  return { reps: null, durationSec, restSec };
}
function ex(name: string, sets: Exercise["sets"], notes?: string): Exercise {
  return { id: id(), name, sets, ...(notes ? { notes } : {}) };
}

export const BUILT_IN_WORKOUTS: Workout[] = [
  {
    id: "full-body-no-equipment",
    name: "Full-Body Express",
    summary: "20 min · no equipment · bodyweight",
    exercises: [
      ex("Jumping Jacks", [timedSet(40, 20), timedSet(40, 20)], "Steady pace, full range."),
      ex("Bodyweight Squats", [repSet(15, 30), repSet(15, 30), repSet(15, 45)], "Sit back, chest up."),
      ex("Push-ups", [repSet(12, 30), repSet(12, 30), repSet(10, 45)], "Knees down to scale."),
      ex("Plank", [timedSet(45, 30), timedSet(45, 30)], "Squeeze glutes, neutral spine."),
      ex("Reverse Lunges", [repSet(10, 30), repSet(10, 45)], "Each leg."),
    ],
  },
  {
    id: "core-finisher",
    name: "Core Finisher",
    summary: "10 min · no equipment · abs",
    exercises: [
      ex("Crunches", [repSet(20, 20), repSet(20, 20)]),
      ex("Bicycle Kicks", [timedSet(40, 20), timedSet(40, 20)]),
      ex("Leg Raises", [repSet(12, 25), repSet(12, 25)]),
      ex("Side Plank", [timedSet(30, 15), timedSet(30, 30)], "Each side."),
    ],
  },
  {
    id: "dumbbell-upper",
    name: "Dumbbell Upper",
    summary: "25 min · dumbbells · push/pull",
    exercises: [
      ex("Dumbbell Press", [repSet(10, 60, 12), repSet(10, 60, 12), repSet(8, 75, 14)]),
      ex("Bent-Over Row", [repSet(10, 60, 12), repSet(10, 60, 12), repSet(8, 75, 14)]),
      ex("Shoulder Press", [repSet(10, 60, 8), repSet(10, 75, 8)]),
      ex("Bicep Curls", [repSet(12, 45, 8), repSet(12, 60, 8)]),
    ],
  },
];

export type PlayerStep =
  | {
      kind: "work";
      exerciseName: string;
      exerciseIndex: number;
      setIndex: number;
      setCount: number;
      reps: number | null;
      durationSec: number | null;
      weightKg?: number;
      notes?: string;
    }
  | { kind: "rest"; durationSec: number; nextExerciseName: string };

/** Flatten a workout into the ordered work/rest steps the player walks. */
export function buildSteps(workout: Workout): PlayerStep[] {
  const steps: PlayerStep[] = [];
  const exercises = workout.exercises;
  for (let ei = 0; ei < exercises.length; ei++) {
    const exercise = exercises[ei]!;
    for (let si = 0; si < exercise.sets.length; si++) {
      const set = exercise.sets[si]!;
      steps.push({
        kind: "work",
        exerciseName: exercise.name,
        exerciseIndex: ei,
        setIndex: si,
        setCount: exercise.sets.length,
        reps: set.reps,
        durationSec: set.durationSec,
        weightKg: set.weightKg,
        notes: exercise.notes,
      });
      const isLastStep = ei === exercises.length - 1 && si === exercise.sets.length - 1;
      if (set.restSec > 0 && !isLastStep) {
        const sameExercise = si < exercise.sets.length - 1;
        const next = sameExercise ? exercise.name : (exercises[ei + 1]?.name ?? "");
        steps.push({ kind: "rest", durationSec: set.restSec, nextExerciseName: next });
      }
    }
  }
  return steps;
}
