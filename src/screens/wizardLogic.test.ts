import { describe, it, expect, beforeEach } from "vitest";
import type { Plan } from "../types";
import { getRepository, __resetRepository } from "../data/repository";
import { commitNewPlan } from "../features/plan/planService";
import { activityForDaysPerWeek } from "../features/goals";
import { requiresLoggingOnly, resolveSafeMode } from "../features/safety/intakeGate";
import {
  DAYS_OPTIONS,
  buildWizardBody,
  createCommitGuard,
  gatedNoticeCopy,
  goalDaysFor,
  seedDaysPerWeek,
  seedSafety,
  seedWizardMode,
  wizardInputsValid,
  wizardNeedsBody,
} from "./wizardLogic";

const basePlan: Plan = {
  id: "p1",
  mode: "get_fit",
  durationWeeks: 2,
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  goals: [],
  safety: { ageBand: "18_39", pregnant: false, cardiacFlag: false, injuries: ["knee"], activityLevel: "moderate" },
  liability: { acknowledged: true, acceptedAt: "2026-09-01T00:00:00Z" },
  createdAt: "2026-09-01T00:00:00Z",
};

const bodyArgs = {
  tracksFood: false,
  hasWorkouts: true,
  sex: "male" as const,
  heightCm: 182,
  weightKg: 100,
  goalWeightKg: undefined,
  direction: "maintain" as const,
  age: 30,
  ageBand: "18_39" as const,
  activityLevel: "moderate" as const,
  experienceLevel: "beginner" as const,
  units: "imperial" as const,
};

describe("f-wizard-settings#1: get_fit collects and saves bodyweight", () => {
  beforeEach(() => __resetRepository());

  it("needs body stats for workout plans, not only food plans", () => {
    expect(wizardNeedsBody(false, true)).toBe(true);
    expect(wizardNeedsBody(true, false)).toBe(true);
    expect(wizardNeedsBody(false, false)).toBe(false);
  });

  it("requires weight (not height) to continue on a get_fit plan", () => {
    const v = { age: 30, tracksFood: false, hasWorkouts: true, heightCm: undefined, weightKg: undefined };
    expect(wizardInputsValid(v)).toBe(false);
    expect(wizardInputsValid({ ...v, weightKg: 100 })).toBe(true);
    // Food plans still need both.
    expect(wizardInputsValid({ ...v, tracksFood: true, hasWorkouts: false, weightKg: 100 })).toBe(false);
    expect(wizardInputsValid({ ...v, tracksFood: true, hasWorkouts: false, weightKg: 100, heightCm: 170 })).toBe(true);
  });

  it("sends the collected weight in a get_fit body and keeps goal/direction food-only", () => {
    const body = buildWizardBody({ ...bodyArgs, goalWeightKg: 90, direction: "lose" });
    expect(body).toMatchObject({ weightKg: 100, heightCm: 182, sex: "male", units: "imperial" });
    expect(body.goalWeightKg).toBeUndefined();
    expect(body.direction).toBeUndefined();
  });

  it("does not send stats the wizard never collected (gated logging_only)", () => {
    const body = buildWizardBody({ ...bodyArgs, hasWorkouts: false });
    expect(body.weightKg).toBeUndefined();
    expect(body.heightCm).toBeUndefined();
    expect(body.sex).toBeUndefined();
  });

  it("saves the user's bodyweight, not the 70 kg default, for a new get_fit plan", async () => {
    const body = buildWizardBody(bodyArgs);
    const res = await commitNewPlan(basePlan, {
      body,
      currentProfile: null,
      currentGoals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    expect(res.profile).toMatchObject({ weightKg: 100, heightCm: 182, sex: "male", units: "imperial" });
    expect((await (await getRepository()).getProfile())?.weightKg).toBe(100);
  });
});

describe("f-wizard-settings#3 / f-plan-gen#7: edit prefills the safety intake", () => {
  it("seeds injuries and flags from the plan being edited", () => {
    const plan: Plan = {
      ...basePlan,
      mode: "logging_only",
      safety: { ...basePlan.safety, pregnant: true, cardiacFlag: true, injuries: ["knee", "shoulder"] },
    };
    expect(seedSafety(plan)).toEqual({ pregnant: true, cardiacFlag: true, injuries: ["knee", "shoulder"] });
  });

  it("starts empty when creating, and tolerates a legacy plan without safety", () => {
    expect(seedSafety(null)).toEqual({ pregnant: false, cardiacFlag: false, injuries: [] });
    const legacy = { ...basePlan, safety: undefined } as unknown as Plan;
    expect(seedSafety(legacy)).toEqual({ pregnant: false, cardiacFlag: false, injuries: [] });
  });

  it("returns a copy, so the wizard cannot mutate the stored plan", () => {
    const seeded = seedSafety(basePlan);
    seeded.injuries.push("back");
    expect(basePlan.safety.injuries).toEqual(["knee"]);
  });

  const fitness = { coachAndWorkouts: true, nutrition: false };

  it("does not keep a forced logging_only plan logging_only", () => {
    expect(seedWizardMode("logging_only", fitness)).toBe("get_fit");
    expect(seedWizardMode("get_fit", fitness)).toBe("get_fit");
    expect(seedWizardMode("logging_only", { coachAndWorkouts: true, nutrition: true })).toBe("both");
    expect(seedWizardMode("eat_better", { coachAndWorkouts: true, nutrition: true })).toBe("eat_better");
    expect(seedWizardMode(undefined, { coachAndWorkouts: true, nutrition: true })).toBe("both");
    expect(seedWizardMode("logging_only", { coachAndWorkouts: false, nutrition: true })).toBe("eat_better");
  });

  it("a logging_only plan stays gated while its flags are set and leaves once they are cleared", () => {
    const plan: Plan = { ...basePlan, mode: "logging_only", safety: { ...basePlan.safety, pregnant: true } };
    const seeded = seedSafety(plan);
    const mode = seedWizardMode(plan.mode, fitness);
    const intake = { ...plan.safety, pregnant: seeded.pregnant, cardiacFlag: seeded.cardiacFlag };
    expect(resolveSafeMode(mode, intake)).toBe("logging_only");
    // The user unticks the mistaken box.
    expect(requiresLoggingOnly({ ...intake, pregnant: false })).toBe(false);
    expect(resolveSafeMode(mode, { ...intake, pregnant: false })).toBe("get_fit");
  });
});

describe("f-wizard-settings#4 / f-plan-gen#10: workout days are stored and seeded", () => {
  it("a get_fit plan's weekly goal is the workout days chip", () => {
    expect(goalDaysFor(true, 5, 0)).toBe(5);
    // logging_only keeps the separate "move most days" chips.
    expect(goalDaysFor(false, 5, 3)).toBe(3);
    expect(goalDaysFor(false, 5, 0)).toBe(0);
  });

  it("reopens a 4-day plan on 4, not 3", () => {
    const plan: Plan = { ...basePlan, weeklyExerciseDays: 4 };
    const profile = { activityLevel: activityForDaysPerWeek(4) } as never;
    expect(seedDaysPerWeek(plan, profile, true)).toBe(4);
  });

  it("round-trips every chip value through the stored plan days", () => {
    for (const d of DAYS_OPTIONS) {
      const plan: Plan = { ...basePlan, weeklyExerciseDays: goalDaysFor(true, d, 0) };
      expect(seedDaysPerWeek(plan, { activityLevel: activityForDaysPerWeek(d) } as never, true)).toBe(d);
    }
  });

  it("falls back to the activity inverse for older plans, and to 3 when creating", () => {
    const profile = { activityLevel: "active" } as never;
    expect(seedDaysPerWeek(basePlan, profile, true)).toBe(5);
    expect(seedDaysPerWeek(null, profile, false)).toBe(3);
    // A stored value outside the chips (e.g. 0 or 7) is ignored.
    expect(seedDaysPerWeek({ ...basePlan, weeklyExerciseDays: 7 }, profile, true)).toBe(5);
  });
});

describe("f-wizard-settings#5: a blank age cannot continue", () => {
  const v = { age: undefined as number | undefined, tracksFood: false, hasWorkouts: false, heightCm: 170, weightKg: 70 };

  it("is invalid without an age, in every mode", () => {
    expect(wizardInputsValid(v)).toBe(false);
    expect(wizardInputsValid({ ...v, hasWorkouts: true })).toBe(false);
    expect(wizardInputsValid({ ...v, tracksFood: true })).toBe(false);
  });

  it("is valid once an age is given", () => {
    expect(wizardInputsValid({ ...v, age: 17 })).toBe(true);
  });
});

describe("f-wizard-settings#6: gate copy does not promise food tracking in Fitness", () => {
  it("talks about no workouts, not food, when nutrition is off", () => {
    const copy = gatedNoticeCopy({ coachAndWorkouts: true, nutrition: false });
    expect(copy).not.toMatch(/food/i);
    expect(copy).toMatch(/doctor/i);
  });

  it("keeps the food wording where food tracking exists", () => {
    expect(gatedNoticeCopy({ coachAndWorkouts: true, nutrition: true })).toMatch(/food & habit tracking/);
  });
});

describe("f-wizard-settings#7: commit guard", () => {
  it("ignores a second tap while the first commit is running", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const guard = createCommitGuard();
    const commit = async () => {
      calls++;
      await gate;
    };
    guard(commit);
    guard(commit);
    await Promise.resolve();
    guard(commit);
    expect(calls).toBe(1);
    release();
    await gate;
    await new Promise((r) => setTimeout(r, 0));
    guard(commit);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });

  it("reports busy state and releases after a failed commit so it can be retried", async () => {
    const states: boolean[] = [];
    const guard = createCommitGuard((b) => states.push(b));
    let calls = 0;
    guard(async () => {
      calls++;
      throw new Error("disk full");
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(states).toEqual([true, false]);
    guard(() => {
      calls++;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });
});
