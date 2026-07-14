/**
 * Workout-program parsing + assembly (W4). Turns the AI's small `program` JSON
 * block into a structured `WorkoutProgram` (workouts + exactly one benchmark),
 * with fresh ids and hard caps so a program can never blow up the app. Kept
 * separate from generate.ts so the adaptation engine (W5) and the editor (W6)
 * can reuse the same builders + guards.
 *
 * Storage stays metric (weightKg / distanceKm / durationSec); the benchmark's
 * `unit` is a display label only.
 */

import type {
  Benchmark,
  BenchmarkMetric,
  Exercise,
  ExerciseSet,
  ProgramWorkout,
  Workout,
  WorkoutKind,
  WorkoutProgram,
  WorkoutSession,
} from "../../types";
import { newId } from "../../data/id";
import { normalizeExerciseKey } from "../explainers/normalizeKey";

const MAX_WORKOUTS = 6;
const MAX_EXERCISES = 10;
const MAX_SETS = 8;

const KINDS = new Set<WorkoutKind>(["strength", "run", "bike"]);
const METRICS = new Set<BenchmarkMetric>(["reps", "weightKg", "durationSec", "distanceKm"]);

const clampInt = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const clampNum = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
};

function parseSet(raw: unknown): ExerciseSet | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const reps = clampInt(o.reps, 1, 100);
  const durationSec = clampInt(o.durationSec, 1, 3600);
  // A set is either rep-based or timed; require at least one.
  if (reps == null && durationSec == null) return null;
  const restSec = clampInt(o.restSec, 0, 600) ?? 45;
  const weightKg = clampNum(o.weightKg, 0, 500);
  return {
    reps: reps ?? null,
    durationSec: durationSec ?? null,
    restSec,
    ...(weightKg != null && weightKg > 0 ? { weightKg } : {}),
  };
}

function parseExercise(raw: unknown): Exercise | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
  if (!name) return null;
  const rawSets = Array.isArray(o.sets) ? o.sets : [];
  const sets = rawSets.slice(0, MAX_SETS).map(parseSet).filter((s): s is ExerciseSet => s !== null);
  if (sets.length === 0) return null;
  const notes = typeof o.notes === "string" ? o.notes.trim().slice(0, 160) : undefined;
  return { id: newId(), name, sets, ...(notes ? { notes } : {}) };
}

function parseWorkout(raw: unknown): Workout | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
  if (!name) return null;
  const kind = KINDS.has(o.kind as WorkoutKind) ? (o.kind as WorkoutKind) : undefined;
  const summary = typeof o.summary === "string" ? o.summary.trim().slice(0, 120) : undefined;
  const description = typeof o.description === "string" ? o.description.trim().slice(0, 400) : undefined;
  // Cardio workouts legitimately carry no exercises; strength must have some.
  const rawEx = Array.isArray(o.exercises) ? o.exercises : [];
  const exercises = rawEx
    .slice(0, MAX_EXERCISES)
    .map(parseExercise)
    .filter((e): e is Exercise => e !== null);
  const isCardio = kind === "run" || kind === "bike";
  if (!isCardio && exercises.length === 0) return null;
  return {
    id: newId(),
    name,
    ...(summary ? { summary } : {}),
    ...(description ? { description } : {}),
    ...(kind ? { kind } : {}),
    exercises,
    origin: "built-in",
  };
}

/** Parse the AI's `benchmark` object into a Benchmark (baseline null, no history). */
function parseBenchmark(raw: unknown): Benchmark | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.exercise === "string" ? o.exercise.trim().slice(0, 80) : "";
  if (!name) return null;
  const metric = METRICS.has(o.metric as BenchmarkMetric) ? (o.metric as BenchmarkMetric) : "reps";
  const target = clampNum(o.target, 0.1, 100000);
  if (target == null) return null;
  const unit =
    typeof o.unit === "string" && o.unit.trim()
      ? o.unit.trim().slice(0, 12)
      : defaultUnit(metric);
  // Higher-is-better for everything except a timed effort (duration): faster wins.
  const lowerIsBetter = o.lowerIsBetter === true || metric === "durationSec";
  return {
    id: newId(),
    exerciseKey: normalizeExerciseKey(name),
    name,
    metric,
    baseline: null,
    target,
    unit,
    ...(lowerIsBetter ? { lowerIsBetter: true } : {}),
    history: [],
  };
}

export function defaultUnit(metric: BenchmarkMetric): string {
  switch (metric) {
    case "weightKg":
      return "kg";
    case "durationSec":
      return "sec";
    case "distanceKm":
      return "km";
    default:
      return "reps";
  }
}

/**
 * Parse a raw AI `program` object into a validated-shape WorkoutProgram, or null
 * if it can't yield at least one workout and exactly one benchmark. Ids are
 * regenerated; baselines start null; the workout whose exercises include the
 * benchmark effort is flagged `isBenchmark` (else the first workout is).
 */
export function parseProgram(raw: unknown): WorkoutProgram | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rawWorkouts = Array.isArray(o.workouts) ? o.workouts : [];
  const workouts = rawWorkouts
    .slice(0, MAX_WORKOUTS)
    .map(parseWorkout)
    .filter((w): w is Workout => w !== null);
  if (workouts.length === 0) return null;

  const benchmark = parseBenchmark(o.benchmark);
  if (!benchmark) return null;

  // Flag the workout that contains the benchmark effort (by normalized key),
  // falling back to the first workout so a benchmark is always reachable.
  const matchIdx = workouts.findIndex((w) =>
    w.exercises.some((e) => normalizeExerciseKey(e.name) === benchmark.exerciseKey),
  );
  const benchIdx = matchIdx >= 0 ? matchIdx : 0;

  const programWorkouts: ProgramWorkout[] = workouts.map((workout, i) => ({
    id: newId(),
    workout,
    ...(i === benchIdx ? { isBenchmark: true, benchmarkId: benchmark.id } : {}),
  }));

  return { workouts: programWorkouts, benchmarks: [benchmark], analysisCursor: 0 };
}

const maxOf = (nums: (number | undefined)[]): number | null => {
  const vals = nums.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return vals.length ? Math.max(...vals) : null;
};

/**
 * The single comparable value a finished session contributes to a benchmark, or
 * null if the session doesn't measure it. Strength metrics read the best set of
 * the matching exercise; cardio metrics read the tracked distance/duration.
 */
export function measureSession(benchmark: Benchmark, session: WorkoutSession): number | null {
  // Cardio benchmark: read straight off the tracked result.
  if (session.cardio) {
    if (benchmark.metric === "distanceKm") return session.cardio.distanceKm ?? null;
    if (benchmark.metric === "durationSec") return session.cardio.durationSec ?? null;
    return null;
  }
  const ex = session.byExercise?.find((e) => e.exerciseKey === benchmark.exerciseKey);
  if (!ex || ex.sets.length === 0) return null;
  switch (benchmark.metric) {
    case "reps":
      return maxOf(ex.sets.map((s) => s.reps));
    case "weightKg":
      return maxOf(ex.sets.map((s) => s.weightKg));
    case "durationSec":
      return maxOf(ex.sets.map((s) => s.durationSec));
    default:
      return null;
  }
}

/**
 * Record a finished session against the program's benchmark(s). Returns a NEW
 * program with the measured value appended to the matching benchmark's history
 * (and `baseline`/`measuredAt` set on the first measurement), or the same
 * program unchanged when the session measures nothing. Immutable — the caller
 * persists the result via `savePlan`.
 */
export function recordBenchmarkResult(
  program: WorkoutProgram,
  session: WorkoutSession,
): WorkoutProgram {
  let changed = false;
  const benchmarks = program.benchmarks.map((b) => {
    // Prefer the explicit benchmarkId tag; fall back to an exercise-key match.
    const tagged = session.benchmarkId != null && session.benchmarkId === b.id;
    if (!tagged && session.benchmarkId != null) return b;
    const value = measureSession(b, session);
    if (value == null) return b;
    changed = true;
    const point = { value, at: session.completedAt, sessionId: session.id };
    return {
      ...b,
      baseline: b.baseline ?? value,
      measuredAt: b.measuredAt ?? session.completedAt,
      history: [...b.history, point],
    };
  });
  return changed ? { ...program, benchmarks } : program;
}

/**
 * Progress toward a benchmark target as a 0..1 fraction, from baseline → target
 * using the latest measurement. Returns null until a baseline exists.
 */
export function benchmarkProgress(b: Benchmark): number | null {
  if (b.baseline == null || b.history.length === 0) return null;
  const latest = b.history[b.history.length - 1]!.value;
  const span = b.target - b.baseline;
  if (span === 0) return 1;
  const frac = (latest - b.baseline) / span;
  return Math.max(0, Math.min(1, frac));
}
