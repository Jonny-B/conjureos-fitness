import { describe, it, expect } from "vitest";
import type { ProgramWorkout, WorkoutProgram } from "../../types";
import { validateProgram } from "./validate";
import { parseProgram } from "./program";
import { fallbackProgram } from "./fallbackTemplates";

const prog = (workouts: ProgramWorkout[]): WorkoutProgram => ({
  workouts,
  benchmarks: [
    { id: "b1", exerciseKey: "bench-press", name: "Bench Press", metric: "reps", baseline: null, target: 10, unit: "reps", history: [] },
  ],
  analysisCursor: 0,
  currentGroup: 1,
});

const strength = (id: string, name: string, exercises: ProgramWorkout["workout"]["exercises"]): ProgramWorkout => ({
  id,
  group: 2,
  workout: { id: `w-${id}`, name, exercises, origin: "user" },
});
const ex = (name: string, nSets: number) => ({
  id: `e-${name}`,
  name,
  sets: Array.from({ length: nSets }, () => ({ reps: 8, durationSec: null, restSec: 60 })),
});
const cardio = (name: string, kind: "run" | "bike", description?: string): ProgramWorkout => ({
  id: `c-${name}`,
  group: 2,
  workout: { id: `w-${name}`, name, kind, exercises: [], origin: "built-in", ...(description ? { description } : {}) },
});

describe("validateProgram — strength workouts need steps", () => {
  it("rejects a strength workout with no exercises", () => {
    const r = validateProgram(prog([strength("a", "Push Day", [])]), "get_fit", []);
    expect(r).toContain('workout "Push Day" has no exercises');
  });

  it("rejects an exercise with no sets", () => {
    const r = validateProgram(prog([strength("a", "Push Day", [ex("Bench Press", 0)])]), "get_fit", []);
    expect(r).toContain('workout "Push Day" exercise "Bench Press" has no sets');
  });

  it("passes a populated strength workout, and cardio with no exercises", () => {
    const p = prog([strength("a", "Push Day", [ex("Bench Press", 3)]), cardio("Easy Ride", "bike")]);
    expect(validateProgram(p, "get_fit", [])).toEqual([]);
  });
});

describe("validateProgram — cardio workouts honour injuries", () => {
  it("rejects a run workout named after a sprint for an ankle injury", () => {
    const p = prog([strength("a", "Push Day", [ex("Bench Press", 3)]), cardio("Hill Sprints", "run", "Six all-out sprints")]);
    expect(validateProgram(p, "get_fit", ["ankle"])).toContain('program workout "Hill Sprints" conflicts with a declared injury');
    expect(validateProgram(p, "get_fit", ["knee"])).toContain('program workout "Hill Sprints" conflicts with a declared injury');
  });

  it("treats kind run as running for an ankle injury, but not for a knee injury", () => {
    const p = prog([strength("a", "Push Day", [ex("Bench Press", 3)]), cardio("Steady Cardio", "run")]);
    expect(validateProgram(p, "get_fit", ["ankle"]).length).toBeGreaterThan(0);
    expect(validateProgram(p, "get_fit", ["knee"])).toEqual([]);
  });

  it("does not test the free-text description (bare substrings would false-positive)", () => {
    const p = prog([strength("a", "Push Day", [ex("Bench Press", 3)]), cardio("Easy Ride", "bike", "grow your endurance")]);
    expect(validateProgram(p, "get_fit", ["lower_back"])).toEqual([]);
  });
});

describe("validateProgram — generated programs still pass", () => {
  it("accepts parseProgram output and the fallback programs", () => {
    const parsed = parseProgram({
      workouts: [
        { name: "Push Day", exercises: [{ name: "Bench Press", sets: [{ reps: 8 }] }] },
        { name: "Easy Run", kind: "run", exercises: [] },
      ],
      benchmark: { exercise: "Bench Press", metric: "reps", target: 12 },
    })!;
    expect(validateProgram(parsed, "get_fit", [])).toEqual([]);
    expect(validateProgram(fallbackProgram("both", [], "beginner")!, "both", [])).toEqual([]);
  });
});
