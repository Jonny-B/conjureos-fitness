import { describe, it, expect, beforeEach } from "vitest";
import type { Plan, Profile, WorkoutProgram } from "../../types";
import { DEFAULT_PROFILE } from "../../types";
import { getRepository, __resetRepository } from "../../data/repository";
import { vfs } from "../../bridge/vfs";
import { applyCoachPlanChange, commitNewPlan, decidePlanEdit, modifyPlanInPlace } from "./planService";

// A user who set their stats and units BEFORE ever making a plan.
const cogProfile: Profile = {
  sex: "male",
  age: 45,
  weightKg: 85,
  activityLevel: "very_active",
  experienceLevel: "intermediate",
  units: "imperial",
};

const plan: Plan = {
  id: "p1",
  mode: "get_fit",
  durationWeeks: 2,
  startDate: "2026-07-22",
  endDate: "2026-08-04",
  goals: [],
  safety: { ageBand: "40_59", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "very_active" },
  liability: { acknowledged: true, acceptedAt: "2026-07-22T00:00:00Z" },
  createdAt: "2026-07-22T00:00:00Z",
};

async function freshStore(): Promise<void> {
  // With no `window`, vfs is an in-memory store that outlives each test's repository.
  await vfs.rm("store.json");
  __resetRepository();
}

describe("commitNewPlan preserves pre-plan profile data", () => {
  beforeEach(freshStore);

  it("keeps existing body stats when the wizard body carries them (prefill)", async () => {
    // The wizard prefills from the profile, so its body mirrors the stored values.
    const res = await commitNewPlan(plan, {
      body: {
        sex: "male",
        age: 45,
        weightKg: 85,
        activityLevel: "very_active",
        experienceLevel: "intermediate",
        units: "imperial",
      },
      currentProfile: cogProfile,
    });
    expect(res.profile).toEqual(cogProfile);
    // …and it's actually persisted, not just returned.
    const repo = await getRepository();
    expect((await repo.getProfile())?.sex).toBe("male");
    expect((await repo.getProfile())?.age).toBe(45);
  });

  it("never overwrites a field the wizard body leaves undefined", async () => {
    // e.g. a gated logging_only plan collects no sex or bodyweight.
    const res = await commitNewPlan(plan, {
      body: { age: 45, activityLevel: "very_active" },
      currentProfile: cogProfile,
    });
    expect(res.profile).toMatchObject({
      sex: "male",
      weightKg: 85,
      experienceLevel: "intermediate",
      units: "imperial",
    });
  });

  it("always leaves a stored profile behind, even when nothing was collected", async () => {
    const res = await commitNewPlan(plan, { currentProfile: null });
    expect(res.profile).toEqual(DEFAULT_PROFILE);
    expect(await (await getRepository()).getProfile()).toEqual(DEFAULT_PROFILE);
  });
});

// ── Editing a plan: the new-vs-modify decision ─────────────────────────
describe("decidePlanEdit", () => {
  const base: Plan = { ...plan, goalText: "get better at the half murph" };

  it("forks a new plan when the goal text changes", () => {
    expect(decidePlanEdit(base, { mode: base.mode, goalText: "train for a 5k", startDate: base.startDate })).toBe("new");
  });
  it("forks a new plan when the mode changes (the safety gate tripped)", () => {
    expect(decidePlanEdit(base, { mode: "logging_only", goalText: base.goalText!, startDate: base.startDate })).toBe("new");
  });
  it("forks a new plan when the start date moves", () => {
    expect(decidePlanEdit(base, { mode: base.mode, goalText: base.goalText!, startDate: "2026-09-01" })).toBe("new");
  });
  it("modifies in place for anything else (same goal/mode/start)", () => {
    // Goal text differing only by whitespace/case is NOT a change.
    expect(decidePlanEdit(base, { mode: base.mode, goalText: "  Get better at the HALF Murph ", startDate: base.startDate })).toBe("modify");
  });
  it("forks a new plan when a goal is typed on a plan that had none", () => {
    const blank: Plan = { ...plan }; // created with the goal box empty (no goalText)
    expect(decidePlanEdit(blank, { mode: blank.mode, goalText: "run a 5k this fall", startDate: blank.startDate })).toBe("new");
  });
  it("still modifies in place when a plan with no goal text is edited with the box blank", () => {
    const blank: Plan = { ...plan };
    expect(decidePlanEdit(blank, { mode: blank.mode, goalText: "  ", startDate: blank.startDate })).toBe("modify");
  });
});

// ── Editing a plan: modify in place ────────────────────────────────────
describe("modifyPlanInPlace", () => {
  beforeEach(freshStore);

  const workoutProgram: WorkoutProgram = {
    workouts: [
      {
        id: "pw1",
        isBenchmark: true,
        group: 1,
        completedAt: "2026-07-23T10:00:00Z",
        workout: { id: "w1", name: "Baseline", exercises: [] },
      },
    ],
    benchmarks: [
      { id: "b1", exerciseKey: "pushup", name: "Push-ups", metric: "reps", baseline: 20, target: 40, unit: "reps", history: [{ value: 20, at: "2026-07-23T10:00:00Z" }] },
    ],
    currentGroup: 1,
    groupsPerCycle: 4,
  };
  const withProgram: Plan = {
    ...plan,
    goals: [{ id: "g1", label: "Three strength sessions", kind: "workout" }],
    program: workoutProgram,
  };

  it("keeps the plan id, mode, goals and the whole program (benchmarks + completedAt)", async () => {
    const res = await modifyPlanInPlace(
      withProgram,
      cogProfile,
      { endDate: "2026-08-11", durationWeeks: 3, weeklyExerciseDays: 4 },
      { currentProfile: cogProfile },
    );
    expect(res.plan.id).toBe(withProgram.id);
    expect(res.plan.mode).toBe("get_fit");
    expect(res.plan.goals).toEqual(withProgram.goals);
    expect(res.plan.endDate).toBe("2026-08-11");
    expect(res.plan.weeklyExerciseDays).toBe(4);
    expect(res.plan.program?.workouts[0]?.completedAt).toBe("2026-07-23T10:00:00Z");
    expect(res.plan.program?.benchmarks[0]?.baseline).toBe(20);
    expect(res.plan.program?.currentGroup).toBe(1);
    expect((await (await getRepository()).getPlan())?.endDate).toBe("2026-08-11");
  });

  it("merges a new bodyweight into the profile", async () => {
    const res = await modifyPlanInPlace(withProgram, { weightKg: 82 }, {}, { currentProfile: cogProfile });
    expect(res.profile).toEqual({ ...cogProfile, weightKg: 82 });
    expect((await (await getRepository()).getProfile())?.weightKg).toBe(82);
  });
});

// ── Coach-driven plan-level changes ────────────────────────────────────
describe("applyCoachPlanChange", () => {
  beforeEach(freshStore);

  it("moves the plan end date and its length", async () => {
    const res = await applyCoachPlanChange(plan, { summary: "Extend to Aug 20", endDate: "2026-08-20" });
    expect(res!.plan.endDate).toBe("2026-08-20");
    expect(res!.plan.durationWeeks).toBe(4);
    expect(res!.plan.id).toBe(plan.id);
    expect((await (await getRepository()).getPlan())?.endDate).toBe("2026-08-20");
  });

  it("returns null when nothing valid changes", async () => {
    expect(await applyCoachPlanChange(plan, { summary: "same", endDate: plan.endDate })).toBeNull();
    expect(await applyCoachPlanChange(plan, { summary: "before start", endDate: "2026-07-01" })).toBeNull();
    expect(await applyCoachPlanChange(plan, { summary: "garbage", endDate: "next week" })).toBeNull();
    expect(await applyCoachPlanChange(null, { summary: "no plan", endDate: "2026-08-20" })).toBeNull();
  });
});

// ── Profile writes build on the STORED profile, not the caller's cached copy ──
describe("profile read-modify-writes re-read the store", () => {
  beforeEach(freshStore);

  it("commitNewPlan keeps a change stored after the caller cached its profile", async () => {
    const repo = await getRepository();
    await repo.saveProfile({ ...cogProfile, weightKg: 80 }); // stored since the cache was taken
    const res = await commitNewPlan(plan, { currentProfile: cogProfile });
    expect((await repo.getProfile())?.weightKg).toBe(80);
    expect(res.profile?.weightKg).toBe(80);
  });

  it("commitNewPlan falls back to the passed profile when nothing is stored", async () => {
    const res = await commitNewPlan(plan, { currentProfile: cogProfile });
    expect(res.profile).toMatchObject({ age: 45, weightKg: 85 });
  });

  it("modifyPlanInPlace builds on the stored profile", async () => {
    const repo = await getRepository();
    await repo.saveProfile({ ...cogProfile, units: "metric" });
    await modifyPlanInPlace(plan, { weightKg: 84 }, {}, { currentProfile: cogProfile });
    const stored = await repo.getProfile();
    expect(stored?.weightKg).toBe(84);
    expect(stored?.units).toBe("metric");
  });
});
