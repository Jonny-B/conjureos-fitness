import { describe, expect, it } from "vitest";
import type { Benchmark, WorkoutSession } from "../../types";
import { measureSession, parseProgram, recordBenchmarkResult } from "./program";

const T = "2026-07-18T10:00:00Z";

const programWith = (benchmark: Record<string, unknown>, exercise = "Plank hold") =>
  parseProgram({
    workouts: [{ name: "Evaluation", exercises: [{ name: exercise, sets: [{ durationSec: 30, restSec: 30 }] }] }],
    benchmark,
  })!;

describe("parseBenchmark lowerIsBetter", () => {
  it("honours an explicit false on a durationSec hold", () => {
    const p = programWith({ exercise: "Plank hold", metric: "durationSec", target: 120, unit: "sec", lowerIsBetter: false });
    expect(p.benchmarks[0]!.lowerIsBetter).toBeFalsy();
  });

  it("defaults a hold (flag omitted) to higher-is-better", () => {
    for (const name of ["Plank hold", "Plank", "Dead hang", "Wall sit", "L-sit"]) {
      const p = programWith({ exercise: name, metric: "durationSec", target: 90 }, name);
      expect(p.benchmarks[0]!.lowerIsBetter, name).toBeFalsy();
    }
  });

  it("still defaults a timed effort (flag omitted) to lower-is-better", () => {
    const p = programWith({ exercise: "1-mile run", metric: "durationSec", target: 480 }, "1-mile run");
    expect(p.benchmarks[0]!.lowerIsBetter).toBe(true);
  });

  it("honours an explicit true, and an explicit false on a timed effort", () => {
    expect(programWith({ exercise: "Plank", metric: "durationSec", target: 60, lowerIsBetter: true }).benchmarks[0]!.lowerIsBetter).toBe(true);
    expect(programWith({ exercise: "Run", metric: "durationSec", target: 60, lowerIsBetter: false }, "Run").benchmarks[0]!.lowerIsBetter).toBeFalsy();
  });
});

describe("parseSet reps handling", () => {
  const sets = (raw: unknown[], extra: unknown[] = []) => {
    const p = parseProgram({
      workouts: [
        {
          name: "Evaluation",
          exercises: [{ name: "Plank", sets: raw }, { name: "Push-up", sets: [{ reps: 10 }] }, ...extra],
        },
      ],
      benchmark: { exercise: "Plank", metric: "reps", target: 30, unit: "reps" },
    });
    return p?.workouts[0]?.workout.exercises.find((e) => e.name === "Plank")?.sets;
  };

  it("keeps an exercise whose reps are 'max' / 'AMRAP' / 'failure' as a rep-based set", () => {
    for (const reps of ["max", "AMRAP", "to failure"]) {
      const s = sets([{ reps, restSec: 30 }]);
      expect(s, String(reps)).toHaveLength(1);
      expect(s![0]!.reps).toBeGreaterThanOrEqual(1);
      expect(s![0]!.durationSec).toBeNull();
    }
  });

  it("reads the leading integer of '8-12' and '10 each'", () => {
    expect(sets([{ reps: "8-12" }])![0]!.reps).toBe(8);
    expect(sets([{ reps: "10 each" }])![0]!.reps).toBe(10);
  });

  it("keeps a timed set timed when reps is 0, non-numeric or 'max'", () => {
    for (const reps of [0, "0", "max"]) {
      const s = sets([{ reps, durationSec: 45 }]);
      expect(s![0]!.reps, String(reps)).toBeNull();
      expect(s![0]!.durationSec).toBe(45);
    }
  });

  it("drops a set with reps 0 and no duration, and still clamps large counts", () => {
    expect(sets([{ reps: 0 }])).toBeUndefined();
    expect(sets([{ reps: 500 }])![0]!.reps).toBe(100);
  });
});

describe("measureSession ignores an empty cardio result", () => {
  const bench = (metric: Benchmark["metric"]): Benchmark => ({
    id: "b1",
    exerciseKey: "run",
    name: "Run",
    metric,
    baseline: null,
    target: 5,
    unit: "km",
    history: [],
  });
  const session = (distanceKm: number, durationSec: number): WorkoutSession => ({
    id: "s1",
    date: "2026-07-18",
    planned: [],
    actual: [],
    reprompts: [],
    benchmarkId: "b1",
    cardio: { distanceKm, durationSec, source: "gps" },
    completedAt: T,
  });

  it("returns null for zero distance or duration", () => {
    expect(measureSession(bench("distanceKm"), session(0, 3))).toBeNull();
    expect(measureSession(bench("durationSec"), session(2, 0))).toBeNull();
  });

  it("still reads a positive result", () => {
    expect(measureSession(bench("distanceKm"), session(2.5, 900))).toBe(2.5);
    expect(measureSession(bench("durationSec"), session(2.5, 900))).toBe(900);
  });

  it("never sets a 0 baseline from an empty GPS session", () => {
    const prog = parseProgram({
      workouts: [{ name: "Run", kind: "run", exercises: [] }],
      benchmark: { exercise: "Run", metric: "distanceKm", target: 5, unit: "km" },
    })!;
    const b = prog.benchmarks[0]!;
    const after = recordBenchmarkResult(prog, { ...session(0, 3), benchmarkId: b.id });
    expect(after.benchmarks[0]!.baseline).toBeNull();
    expect(after.benchmarks[0]!.history).toHaveLength(0);
  });
});
