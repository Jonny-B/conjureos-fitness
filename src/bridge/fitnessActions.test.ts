/**
 * The fitness action surface (fitnessActions.ts), exercised through
 * `registerActions` the way ConjureOS reaches it. Params arrive from other,
 * untrusted apps, so the refusals matter as much as the answers. The contract
 * tests at the bottom hold every real result to its declared `returns`:
 * another app's `needs` match against those schemas and fail closed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Plan, Profile, ProgramWorkout, Workout, WorkoutSession } from "../types";
import { shiftDate, todayISO } from "../features/diary";
import { weekToDate } from "../features/exercise";

type Handler = (params?: unknown) => Promise<unknown>;

const db = {
  sessions: [] as WorkoutSession[],
  profile: null as Profile | null,
  plan: null as Plan | null,
};

const repo = {
  listWorkoutSessions: async () =>
    [...db.sessions].sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
  saveWorkoutSession: async (s: WorkoutSession) => {
    db.sessions = db.sessions.filter((x) => x.id !== s.id).concat(s);
  },
  getProfile: async () => db.profile,
  getPlan: async () => db.plan,
};

vi.mock("../data/repository", () => ({ getRepository: async () => repo }));

let actions: Record<string, Handler> = {};

beforeEach(async () => {
  db.sessions = [];
  db.profile = null;
  db.plan = null;
  (globalThis as { window?: unknown }).window = {
    __conjureos: { actions: { register: async (m: Record<string, Handler>) => void (actions = m) } },
  };
  const { registerActions } = await import("./actions");
  await registerActions();
});

const call = (name: string, params?: unknown) => {
  const fn = actions[name];
  if (!fn) throw new Error(`action ${name} is not registered`);
  return fn(params);
};

const today = todayISO();
let seq = 0;
function session(date: string, extra: Partial<WorkoutSession> = {}): WorkoutSession {
  seq += 1;
  return {
    id: `s${seq}`,
    date,
    planned: [],
    actual: [],
    reprompts: [],
    completedAt: `${date}T0${seq % 10}:00:00.000Z`,
    ...extra,
  };
}

const profile = (weightKg: number): Profile =>
  ({ sex: "female", age: 30, heightCm: 170, weightKg, activityLevel: "moderate", direction: "maintain", units: "metric" }) as Profile;

function workout(name: string, extra: Partial<Workout> = {}): Workout {
  return {
    id: `w-${name}`,
    name,
    exercises: [
      { id: "e1", name: "Push-up", sets: [1, 2, 3].map(() => ({ reps: 10, durationSec: null, restSec: 60 })) },
      { id: "e2", name: "Plank", sets: [1, 2].map(() => ({ reps: null, durationSec: 45, restSec: 30 })) },
    ],
    ...extra,
  };
}

function planWith(workouts: ProgramWorkout[], extra: Partial<Plan> = {}): Plan {
  return {
    id: "p1",
    mode: "get_fit",
    durationWeeks: 4,
    startDate: today,
    endDate: shiftDate(today, 27),
    goals: [],
    safety: {} as Plan["safety"],
    liability: {} as Plan["liability"],
    createdAt: `${today}T00:00:00.000Z`,
    program: { workouts, benchmarks: [], currentGroup: 2, groupsPerCycle: 4 },
    ...extra,
  };
}

describe("listWorkouts", () => {
  it("defaults to the last 7 days, newest first", async () => {
    db.sessions = [
      session(today, { workoutName: "Today" }),
      session(shiftDate(today, -6), { workoutName: "Six days ago" }),
      session(shiftDate(today, -7), { workoutName: "Too old" }),
    ];
    const r = (await call("listWorkouts")) as { from: string; to: string; workouts: { name: string }[] };
    expect(r.to).toBe(today);
    expect(r.from).toBe(shiftDate(today, -6));
    expect(r.workouts.map((w) => w.name)).toEqual(["Today", "Six days ago"]);
  });

  it("leaves out wearable-synced sessions, which Health already counts", async () => {
    db.sessions = [
      session(today, { workoutName: "Mine", caloriesBurned: 100 }),
      session(today, { workoutName: "Watch", source: "healthkit", caloriesBurned: 300 }),
      session(today, { workoutName: "Phone", source: "health_connect", caloriesBurned: 300 }),
    ];
    const r = (await call("listWorkouts")) as { workouts: { name: string }[] };
    expect(r.workouts.map((w) => w.name)).toEqual(["Mine"]);
  });

  it("leaves out benchmark entries: typed-in results are not a workout done", async () => {
    db.sessions = [
      session(today, { workoutName: "Mine", caloriesBurned: 100 }),
      session(today, { source: "benchmark_entry", cardio: { distanceKm: 0, durationSec: 1500, source: "manual" } }),
    ];
    const r = (await call("listWorkouts")) as { workouts: { name: string }[] };
    expect(r.workouts.map((w) => w.name)).toEqual(["Mine"]);
  });

  it("reports stored calories as supplied, and estimates missing ones from bodyweight", async () => {
    db.profile = profile(80);
    db.sessions = [
      session(today, { workoutName: "Given", caloriesBurned: 250, durationSec: 1800 }),
      session(today, { workoutName: "Guessed", durationSec: 3600, byExercise: [{ exerciseKey: "x", name: "X", sets: [] }] }),
    ];
    const r = (await call("listWorkouts")) as {
      workouts: { name: string; caloriesBurned: number; caloriesEstimated: boolean; type: string; durationMin: number }[];
    };
    const given = r.workouts.find((w) => w.name === "Given")!;
    const guessed = r.workouts.find((w) => w.name === "Guessed")!;
    expect(given).toMatchObject({ caloriesBurned: 250, caloriesEstimated: false, durationMin: 30 });
    // Strength MET 5 × 80 kg × 1 h.
    expect(guessed).toMatchObject({ caloriesBurned: 400, caloriesEstimated: true, type: "strength", durationMin: 60 });
  });

  it("falls back to ~6 kcal/min with no bodyweight, and never calls AI", async () => {
    db.sessions = [session(today, { durationSec: 600 })];
    const r = (await call("listWorkouts")) as { workouts: { caloriesBurned: number }[] };
    expect(r.workouts[0]!.caloriesBurned).toBe(60);
  });

  it("gives a run's distance but never its route", async () => {
    db.sessions = [
      session(today, {
        workoutName: "Morning Run",
        cardio: { distanceKm: 5.123, durationSec: 1500, source: "gps", track: [{ lat: 1, lon: 2, t: 3 }] },
      }),
    ];
    const r = (await call("listWorkouts")) as { workouts: Record<string, unknown>[] };
    expect(r.workouts[0]).toMatchObject({ distanceKm: 5.12, type: "cardio", durationMin: 25 });
    expect(JSON.stringify(r)).not.toContain("lat");
  });

  it("honours from/to and limit, and clamps a very wide range", async () => {
    db.sessions = [0, 1, 2, 3].map((i) => session(shiftDate(today, -i)));
    const r = (await call("listWorkouts", { from: shiftDate(today, -2), to: shiftDate(today, -1) })) as {
      workouts: { date: string }[];
    };
    expect(r.workouts.map((w) => w.date)).toEqual([shiftDate(today, -1), shiftDate(today, -2)]);
    const limited = (await call("listWorkouts", { limit: 2 })) as { workouts: unknown[] };
    expect(limited.workouts).toHaveLength(2);
    const wide = (await call("listWorkouts", { from: "2000-01-01" })) as { from: string };
    expect(wide.from).toBe(shiftDate(today, -91));
  });

  it("refuses bad params", async () => {
    await expect(call("listWorkouts", { from: today, to: shiftDate(today, -1) })).rejects.toThrow(/on or before/);
    await expect(call("listWorkouts", { to: "2026-02-30" })).rejects.toThrow(/params\.to must be a real calendar date/);
    await expect(call("listWorkouts", { limit: 0 })).rejects.toThrow(/positive/);
    await expect(call("listWorkouts", "yesterday")).rejects.toThrow(/object/);
  });
});

describe("trainingSummary", () => {
  it("counts this week's workouts and active days against the plan's goal", async () => {
    const week = weekToDate(today);
    db.plan = planWith([], { weeklyExerciseDays: 3 });
    db.sessions = [
      session(week[0]!, { durationSec: 1200, caloriesBurned: 100 }),
      session(week[0]!, { durationSec: 600, caloriesBurned: 50 }),
      session(shiftDate(week[0]!, -1), { durationSec: 600, caloriesBurned: 999 }), // last week
      session(today, { source: "healthkit", durationSec: 600, caloriesBurned: 999 }),
    ];
    const r = await call("trainingSummary");
    expect(r).toMatchObject({
      weekStart: week[0],
      through: today,
      workouts: 2,
      activeDays: 1,
      activeDates: [week[0]],
      weeklyGoalDays: 3,
      minutes: 30,
      caloriesBurned: 150,
      hasPlan: true,
    });
  });

  it("does not count a benchmark entry as a workout or an active day", async () => {
    db.sessions = [
      session(today, { source: "benchmark_entry", cardio: { distanceKm: 0, durationSec: 1500, source: "manual" } }),
    ];
    expect(await call("trainingSummary")).toMatchObject({ workouts: 0, activeDays: 0, minutes: 0, caloriesBurned: 0 });
  });

  it("reports no goal and no plan honestly", async () => {
    const r = await call("trainingSummary");
    expect(r).toMatchObject({ workouts: 0, weeklyGoalDays: 0, hasPlan: false, distanceKm: 0 });
  });

  it("refuses a future date", async () => {
    await expect(call("trainingSummary", { date: shiftDate(today, 1) })).rejects.toThrow(/future/);
  });
});

describe("nextWorkout", () => {
  it("says so when there is no plan", async () => {
    const r = await call("nextWorkout");
    expect(r).toMatchObject({ hasPlan: false, hasProgram: false });
    expect((r as { workout?: unknown }).workout).toBeUndefined();
  });

  it("says so when the plan has no program", async () => {
    db.plan = planWith([], { program: undefined });
    expect(await call("nextWorkout")).toMatchObject({ hasPlan: true, hasProgram: false });
  });

  it("returns the first unfinished workout in the current group, with its sets", async () => {
    db.plan = planWith([
      { id: "pw1", workout: workout("Done One"), group: 2, completedAt: "2026-09-01T00:00:00Z" },
      { id: "pw2", workout: workout("Up Next", { summary: "20 min, no equipment" }), group: 2 },
      { id: "pw3", workout: workout("Later"), group: 2 },
      { id: "pw4", workout: workout("Next Group"), group: 3 },
    ]);
    const r = (await call("nextWorkout")) as {
      workout: { id: string; name: string; summary: string; exercises: { name: string; prescription: string }[] };
      group: number;
      groupDone: number;
      groupSize: number;
      evaluation: boolean;
      message: string;
    };
    expect(r.workout).toMatchObject({ id: "pw2", name: "Up Next", summary: "20 min, no equipment" });
    expect(r.workout.exercises).toEqual([
      { name: "Push-up", prescription: "3 × 10 reps" },
      { name: "Plank", prescription: "2 × 45s" },
    ]);
    expect(r).toMatchObject({ group: 2, groupDone: 1, groupSize: 3, evaluation: false });
    expect(r.message).toContain("Up Next");
  });

  it("returns no workout once the group is finished", async () => {
    db.plan = planWith([{ id: "pw1", workout: workout("Only"), group: 2, completedAt: "2026-09-01T00:00:00Z" }]);
    const r = await call("nextWorkout");
    expect(r).toMatchObject({ hasProgram: true, groupDone: 1, groupSize: 1 });
    expect((r as { workout?: unknown }).workout).toBeUndefined();
  });

  it("gives a run its target", async () => {
    db.plan = planWith([
      { id: "pw1", workout: workout("5K", { kind: "run", exercises: [], cardioTarget: { distanceKm: 5 } }), group: 2 },
    ]);
    const r = (await call("nextWorkout")) as { workout: { type: string; target: string } };
    expect(r.workout).toMatchObject({ type: "run", target: "5 km" });
  });
});

describe("logWorkout", () => {
  it("records a workout with only a duration, estimating its calories", async () => {
    db.profile = profile(70);
    const r = await call("logWorkout", { durationMin: 30, type: "Running", distanceKm: 5 });
    // Running MET 9.8 × 70 kg × 0.5 h = 343.
    expect(r).toMatchObject({ name: "Running", durationMin: 30, caloriesBurned: 343, caloriesEstimated: true, date: today });
    const saved = db.sessions[0]!;
    expect(saved).toMatchObject({ source: "logWorkout", activity: "running", durationSec: 1800, caloriesEstimated: true });
    expect(saved.cardio).toMatchObject({ distanceKm: 5, durationSec: 1800, avgPaceSecPerKm: 360, source: "manual" });
  });

  it("keeps stated calories and a caller's name", async () => {
    const r = await call("logWorkout", { durationMin: 45, name: "Spin class", calories: 410, date: shiftDate(today, -1) });
    expect(r).toMatchObject({ name: "Spin class", caloriesBurned: 410, caloriesEstimated: false });
    expect(db.sessions[0]!.caloriesEstimated).toBeUndefined();
  });

  it("then shows up in listWorkouts and trainingSummary", async () => {
    await call("logWorkout", { durationMin: 20, type: "yoga", calories: 80 });
    const list = (await call("listWorkouts")) as { workouts: { type: string; caloriesBurned: number }[] };
    expect(list.workouts[0]).toMatchObject({ type: "yoga", caloriesBurned: 80 });
    expect(await call("trainingSummary")).toMatchObject({ workouts: 1, minutes: 20 });
  });

  it("refuses what it cannot record", async () => {
    await expect(call("logWorkout", {})).rejects.toThrow(/durationMin/);
    await expect(call("logWorkout", { durationMin: 0 })).rejects.toThrow(/positive/);
    await expect(call("logWorkout", { durationMin: 30, date: shiftDate(today, 1) })).rejects.toThrow(/future/);
    await expect(call("logWorkout", { durationMin: 30, type: "x".repeat(41) })).rejects.toThrow(/40/);
    await expect(call("logWorkout", { durationMin: 30, calories: -5 })).rejects.toThrow(/non-negative/);
    expect(db.sessions).toHaveLength(0);
  });
});

// ── Contract: real results against the declared `returns` ──────────────

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema };

/** Every value present matches its declared type; every required key is present. */
function conforms(value: unknown, schema: Schema, path = "$"): string[] {
  const errs: string[] = [];
  const t = schema.type;
  if (t === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path}: not an object`];
    const v = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in v)) errs.push(`${path}.${k}: required but missing`);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in v) errs.push(...conforms(v[k], sub, `${path}.${k}`));
    }
    for (const k of Object.keys(v)) if (!(k in (schema.properties ?? {}))) errs.push(`${path}.${k}: not declared`);
  } else if (t === "array") {
    if (!Array.isArray(value)) return [`${path}: not an array`];
    value.forEach((item, i) => schema.items && errs.push(...conforms(item, schema.items, `${path}[${i}]`)));
  } else if (t === "integer") {
    if (!Number.isInteger(value)) errs.push(`${path}: not an integer`);
  } else if (t === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) errs.push(`${path}: not a number`);
  } else if (t === "string" || t === "boolean") {
    if (typeof value !== t) errs.push(`${path}: not a ${t}`);
  }
  return errs;
}

describe("results match the manifest's declared returns", () => {
  const manifest = async () =>
    ((await import("../../package.json")) as unknown as {
      default: { conjureos: { actions: Record<string, { returns: Schema }> } };
    }).default.conjureos.actions;

  it("for every action, on a populated store", async () => {
    db.profile = profile(75);
    db.plan = planWith([{ id: "pw1", workout: workout("Next", { summary: "s" }), group: 2 }], { weeklyExerciseDays: 4 });
    db.sessions = [
      session(today, { workoutName: "Lift", durationSec: 1500, byExercise: [] }),
      session(today, { workoutName: "Run", cardio: { distanceKm: 3, durationSec: 900, source: "gps" } }),
    ];
    const m = await manifest();
    const results: Record<string, unknown> = {
      listWorkouts: await call("listWorkouts"),
      trainingSummary: await call("trainingSummary"),
      nextWorkout: await call("nextWorkout"),
      logWorkout: await call("logWorkout", { durationMin: 10, type: "walk" }),
    };
    for (const [name, value] of Object.entries(results)) {
      expect(conforms(value, m[name]!.returns), name).toEqual([]);
    }
  });

  it("for nextWorkout with no plan", async () => {
    const m = await manifest();
    expect(conforms(await call("nextWorkout"), m.nextWorkout!.returns)).toEqual([]);
  });

  it("keeps listWorkouts' required item fields — other apps' needs depend on them", async () => {
    const m = await manifest();
    const items = (m.listWorkouts!.returns.properties!.workouts as Schema).items!;
    // Conjure Health's `workoutSource` need requires id, date and caloriesBurned.
    // Removing any field from this list silently disconnects consumers.
    expect(items.required).toEqual(
      expect.arrayContaining(["id", "date", "name", "type", "durationMin", "caloriesBurned", "caloriesEstimated", "completedAt"]),
    );
  });
});
