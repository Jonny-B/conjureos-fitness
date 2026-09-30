import { describe, it, expect, beforeEach } from "vitest";
import type { Plan } from "../types";
import { getRepository, __resetRepository } from "../data/repository";
import { commitNewPlan } from "../features/plan/planService";
import { activityForDaysPerWeek } from "../features/activity";
import { requiresLoggingOnly, resolveSafeMode } from "../features/safety/intakeGate";
import {
  DAYS_OPTIONS,
  GATED_NOTICE,
  buildWizardBody,
  createCommitGuard,
  seedDaysPerWeek,
  seedSafety,
  wizardInputsValid,
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
  hasWorkouts: true,
  sex: "male" as const,
  weightKg: 100,
  age: 30,
  ageBand: "18_39" as const,
  activityLevel: "moderate" as const,
  experienceLevel: "beginner" as const,
  units: "imperial" as const,
};

describe("f-wizard-settings#1: get_fit collects and saves bodyweight", () => {
  beforeEach(() => __resetRepository());

  it("requires weight to continue on a get_fit plan, and not on a gated one", () => {
    const v = { age: 30, hasWorkouts: true, weightKg: undefined };
    expect(wizardInputsValid(v)).toBe(false);
    expect(wizardInputsValid({ ...v, weightKg: 100 })).toBe(true);
    expect(wizardInputsValid({ ...v, hasWorkouts: false })).toBe(true);
  });

  it("sends the collected weight and sex in a get_fit body", () => {
    const body = buildWizardBody(bodyArgs);
    expect(body).toMatchObject({ weightKg: 100, sex: "male", age: 30, units: "imperial" });
    expect(body).not.toHaveProperty("heightCm");
  });

  it("does not send stats the wizard never collected (gated logging_only)", () => {
    const body = buildWizardBody({ ...bodyArgs, hasWorkouts: false });
    expect(body.weightKg).toBeUndefined();
    expect(body.sex).toBeUndefined();
    expect(body.experienceLevel).toBeUndefined();
  });

  it("saves the user's bodyweight, not the 70 kg default, for a new get_fit plan", async () => {
    const body = buildWizardBody(bodyArgs);
    const res = await commitNewPlan(basePlan, { body, currentProfile: null });
    expect(res.profile).toMatchObject({ weightKg: 100, sex: "male", units: "imperial" });
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

  it("a logging_only plan stays gated while its flags are set and leaves once they are cleared", () => {
    const plan: Plan = { ...basePlan, mode: "logging_only", safety: { ...basePlan.safety, pregnant: true } };
    const seeded = seedSafety(plan);
    // The wizard always requests get_fit; only the intake can gate it.
    const intake = { ...plan.safety, pregnant: seeded.pregnant, cardiacFlag: seeded.cardiacFlag };
    expect(resolveSafeMode("get_fit", intake)).toBe("logging_only");
    // The user unticks the mistaken box.
    expect(requiresLoggingOnly({ ...intake, pregnant: false })).toBe(false);
    expect(resolveSafeMode("get_fit", { ...intake, pregnant: false })).toBe("get_fit");
  });
});

describe("f-wizard-settings#4 / f-plan-gen#10: workout days are stored and seeded", () => {
  it("reopens a 4-day plan on 4, not 3", () => {
    const plan: Plan = { ...basePlan, weeklyExerciseDays: 4 };
    const profile = { activityLevel: activityForDaysPerWeek(4) } as never;
    expect(seedDaysPerWeek(plan, profile, true)).toBe(4);
  });

  it("round-trips every chip value through the stored plan days", () => {
    for (const d of DAYS_OPTIONS) {
      const plan: Plan = { ...basePlan, weeklyExerciseDays: d };
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
  const v = { age: undefined as number | undefined, hasWorkouts: false, weightKg: 70 };

  it("is invalid without an age, in every mode", () => {
    expect(wizardInputsValid(v)).toBe(false);
    expect(wizardInputsValid({ ...v, hasWorkouts: true })).toBe(false);
  });

  it("is valid once an age is given", () => {
    expect(wizardInputsValid({ ...v, age: 17 })).toBe(true);
  });
});

describe("f-wizard-settings#6: gate copy does not promise food tracking in Fitness", () => {
  it("talks about no workouts, not food", () => {
    expect(GATED_NOTICE).not.toMatch(/food/i);
    expect(GATED_NOTICE).toMatch(/doctor/i);
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
