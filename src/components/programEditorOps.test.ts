import { describe, it, expect } from "vitest";
import { parseProgram, measureSession } from "../features/plan/program";
import { normalizeExerciseKey } from "../features/explainers/normalizeKey";
import type { WorkoutProgram, WorkoutSession } from "../types";
import { editorSaveReasons, renameBenchmark, renameExercise } from "./programEditorOps";

const make = (): WorkoutProgram =>
  parseProgram({
    workouts: [
      { name: "Evaluation", exercises: [{ name: "Push-ups", sets: [{ reps: 10 }] }] },
      { name: "Training", exercises: [{ name: "Squats", sets: [{ reps: 10 }] }] },
    ],
    benchmark: { exercise: "Push-ups", metric: "reps", target: 30 },
  })!;

/** A finished session the way WorkoutRunner records it: keyed by exercise name. */
const sessionFor = (p: WorkoutProgram): WorkoutSession => {
  const name = p.workouts[0]!.workout.exercises[0]!.name;
  return {
    byExercise: [{ exerciseKey: normalizeExerciseKey(name), sets: [{ reps: 20 }] }],
  } as unknown as WorkoutSession;
};

describe("renameBenchmark", () => {
  it("renames the linked exercise so the benchmark is still measured", () => {
    let d = make();
    // per keystroke, like the input's onChange
    for (const n of ["Max push-up", "Max push-ups"]) d = renameBenchmark(d, 0, n);
    expect(d.benchmarks[0]!.exerciseKey).toBe("max-push-ups");
    expect(d.workouts[0]!.workout.exercises[0]!.name).toBe("Max push-ups");
    expect(d.workouts[1]!.workout.exercises[0]!.name).toBe("Squats");
    expect(measureSession(d.benchmarks[0]!, sessionFor(d))).toBe(20);
  });
});

describe("renameExercise", () => {
  it("drags the benchmark along when the measuring exercise is renamed", () => {
    let d = make();
    for (const n of ["Pushups", "Push ups!"]) d = renameExercise(d, 0, 0, n);
    expect(d.benchmarks[0]!.name).toBe("Push ups!");
    expect(d.benchmarks[0]!.exerciseKey).toBe("push-ups");
    expect(measureSession(d.benchmarks[0]!, sessionFor(d))).toBe(20);
  });

  it("leaves the benchmark alone when an unrelated exercise is renamed", () => {
    const d = renameExercise(make(), 1, 0, "Lunges");
    expect(d.workouts[1]!.workout.exercises[0]!.name).toBe("Lunges");
    expect(d.benchmarks[0]!.exerciseKey).toBe("push-ups");
    expect(d.workouts[0]!.workout.exercises[0]!.name).toBe("Push-ups");
  });
});

describe("editorSaveReasons", () => {
  it("passes a generated program", () => {
    expect(editorSaveReasons(make(), "get_fit", [])).toEqual([]);
  });

  it("rejects a program whose benchmark workout was removed", () => {
    const d = make();
    const noBench = { ...d, workouts: d.workouts.filter((pw) => !pw.isBenchmark) };
    expect(editorSaveReasons(noBench, "get_fit", [])).toContain("program needs an assessment (benchmark) workout");
  });
});
