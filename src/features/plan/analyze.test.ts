import { describe, it, expect } from "vitest";
import type { Benchmark, WorkoutProgram, WorkoutSession } from "../../types";
import { applyAdjustment, buildAnalysisPrompt, parseAdjustment, shouldAnalyze } from "./analyze";

const program: WorkoutProgram = {
  workouts: [{ id: "pw1", group: 1, workout: { id: "w1", name: "A", exercises: [{ id: "e1", name: "Push-Ups", sets: [{ reps: 10, durationSec: null, restSec: 60 }] }] } }],
  benchmarks: [],
  currentGroup: 1,
  groupsPerCycle: 4,
};

describe("buildAnalysisPrompt preferences", () => {
  it("includes the coach-feedback block so progression honors it", () => {
    const out = buildAnalysisPrompt(program, [], "Preferences/constraints:\n  - hates burpees");
    expect(out).toMatch(/HONOR these/);
    expect(out).toMatch(/hates burpees/);
  });
  it("omits the block when there are no preferences", () => {
    const out = buildAnalysisPrompt(program, []);
    expect(out).not.toMatch(/HONOR these/);
  });
});

const bench = (exerciseKey: string, name: string, metric: Benchmark["metric"], unit: string, target: number, lowerIsBetter?: boolean): Benchmark => ({
  id: `b-${exerciseKey}`, exerciseKey, name, metric, baseline: null, target, unit, history: [], ...(lowerIsBetter ? { lowerIsBetter } : {}),
});
const murph: WorkoutProgram = {
  ...program,
  benchmarks: [
    bench("pull-up", "Pull-ups", "reps", "reps", 15),
    bench("push-up", "Push-ups", "reps", "reps", 40),
    bench("mile-run", "1 mile run", "durationSec", "s", 600, true),
  ],
};
const targets = (p: WorkoutProgram) => p.benchmarks.map((b) => b.target);

describe("benchmarkTargetDelta targets one benchmark", () => {
  it("defaults to the first benchmark and leaves the others alone", () => {
    const adj = parseAdjustment('{"summary":"x","changes":[],"benchmarkTargetDelta":2}')!;
    expect(targets(applyAdjustment(murph, adj))).toEqual([17, 40, 600]);
  });
  it("applies to the benchmark named by benchmarkKey", () => {
    const adj = parseAdjustment('{"summary":"x","changes":[],"benchmarkTargetDelta":-15,"benchmarkKey":" mile-run "}')!;
    expect(adj.benchmarkKey).toBe("mile-run");
    expect(targets(applyAdjustment(murph, adj))).toEqual([15, 40, 585]);
  });
  it("falls back to the first benchmark for an unknown key", () => {
    const adj = parseAdjustment('{"summary":"x","changes":[],"benchmarkTargetDelta":1,"benchmarkKey":"nope"}')!;
    expect(targets(applyAdjustment(murph, adj))).toEqual([16, 40, 600]);
  });
  it("describes every benchmark to the model", () => {
    const out = buildAnalysisPrompt(murph, []);
    expect(out).toMatch(/key pull-up/);
    expect(out).toMatch(/key push-up/);
    expect(out).toMatch(/key mile-run.*target 600 \(lower is better\)/);
  });
});

const sess = (over: Partial<WorkoutSession>): WorkoutSession => ({
  id: "s", date: "2026-09-30", planned: [], actual: [], reprompts: [], completedAt: "2026-09-30T10:00:00Z", ...over,
});
const pullUps = { exerciseKey: "pull-up", name: "Pull-Ups", sets: [{ reps: 12, startedAt: "2026-09-30T10:00:00Z", completedAt: "2026-09-30T10:00:30Z" }] } as never;

describe("buildAnalysisPrompt cardio sessions", () => {
  it("keeps strength results of a session that also has a cardio block, without 0.00 km", () => {
    const out = buildAnalysisPrompt(program, [sess({ byExercise: [pullUps], cardio: { distanceKm: 0, durationSec: 570, source: "manual" } })]);
    expect(out).toMatch(/Pull-Ups \(pull-up\): 12 reps/);
    expect(out).toMatch(/cardio 9\.5 min\./);
    expect(out).not.toMatch(/0\.00 km/);
  });
  it("omits a zero duration", () => {
    const out = buildAnalysisPrompt(program, [sess({ cardio: { distanceKm: 1.6, durationSec: 0, source: "manual" } })]);
    expect(out).toMatch(/- 2026-09-30: cardio 1\.60 km\./);
    expect(out).not.toMatch(/0 min/);
  });
  it("keeps the single-line format for a plain cardio session", () => {
    const out = buildAnalysisPrompt(program, [sess({ cardio: { distanceKm: 5, durationSec: 1800, source: "gps" } })]);
    expect(out).toMatch(/- 2026-09-30: cardio 5\.00 km in 30 min\./);
  });
});

describe("shouldAnalyze", () => {
  const withCursor = (analysisCursor?: number): WorkoutProgram => ({ ...program, analysisCursor });
  it("is due after the interval since the cursor", () => {
    expect(shouldAnalyze(withCursor(6), 8)).toBe(false);
    expect(shouldAnalyze(withCursor(6), 9)).toBe(true);
    expect(shouldAnalyze(withCursor(undefined), 3)).toBe(true);
  });
  it("treats a cursor above the session count (history cleared) as 0", () => {
    expect(shouldAnalyze(withCursor(6), 2)).toBe(false);
    expect(shouldAnalyze(withCursor(6), 3)).toBe(true);
  });
});
