import { describe, it, expect, beforeEach } from "vitest";
import type { Plan, Profile } from "../../types";
import { getRepository, __resetRepository } from "../../data/repository";
import { commitNewPlan } from "./planService";

// A user who filled in the cog (real body stats) BEFORE ever making a plan.
const cogProfile: Profile = {
  sex: "male",
  age: 45,
  heightCm: 180,
  weightKg: 85,
  activityLevel: "very_active",
  direction: "lose",
  goalWeightKg: 78,
  units: "imperial",
};

const plan: Plan = {
  id: "p1",
  mode: "both",
  durationWeeks: 2,
  startDate: "2026-07-22",
  endDate: "2026-08-04",
  goals: [],
  targets: { dailyCalories: 2100, protein: 150, carbs: 200, fat: 70 },
  safety: { ageBand: "40_59", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "very_active" },
  liability: { acknowledged: true, acceptedAt: "2026-07-22T00:00:00Z" },
  createdAt: "2026-07-22T00:00:00Z",
};

describe("commitNewPlan preserves pre-plan profile data", () => {
  beforeEach(() => {
    __resetRepository();
  });

  it("keeps existing cog body stats when the wizard body carries them (prefill)", async () => {
    // The wizard prefills from the profile, so its body mirrors the cog values.
    const res = await commitNewPlan(plan, {
      body: {
        sex: "male",
        age: 45,
        heightCm: 180,
        weightKg: 85,
        goalWeightKg: 78,
        activityLevel: "very_active",
        direction: "lose",
        units: "imperial",
      },
      currentProfile: cogProfile,
      currentGoals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    expect(res.profile).toMatchObject({
      sex: "male",
      age: 45,
      heightCm: 180,
      weightKg: 85,
      goalWeightKg: 78,
      activityLevel: "very_active",
      direction: "lose",
      units: "imperial",
    });
    // …and it's actually persisted, not just returned.
    const repo = await getRepository();
    expect((await repo.getProfile())?.sex).toBe("male");
    expect((await repo.getProfile())?.age).toBe(45);
  });

  it("never overwrites a cog field the wizard body leaves undefined", async () => {
    // e.g. a "get fit" (workouts-only) plan collects no sex/height/weight.
    const res = await commitNewPlan(plan, {
      body: { age: 45, activityLevel: "very_active" },
      currentProfile: cogProfile,
      currentGoals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    // Untouched fields survive from the existing profile.
    expect(res.profile).toMatchObject({
      sex: "male",
      heightCm: 180,
      weightKg: 85,
      goalWeightKg: 78,
      direction: "lose",
      units: "imperial",
    });
  });
});
