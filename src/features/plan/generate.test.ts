import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LiabilityAck } from "../../types";
import type { PlanInput } from "./model";

// Control the AI bridge: `complete` is routed per-test by which system prompt
// (core vs program) it receives; the plan generator always thinks AI is present.
const { complete } = vi.hoisted(() => ({ complete: vi.fn<(req: { system: string }) => Promise<string>>() }));
// Stub only the host-dependent surface; pure helpers (extractJson) stay real.
vi.mock("../../bridge/ai", async (orig) => ({
  ...(await orig<typeof import("../../bridge/ai")>()),
  complete,
  isAiAvailable: () => true,
}));

import { createPlan } from "./generate";

const input: PlanInput = {
  mode: "get_fit",
  goalText: "run a 5K and feel less winded",
  durationWeeks: 8,
  daysPerWeek: 3,
  experienceLevel: "beginner",
  equipment: "none",
  safety: { ageBand: "18_39", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "light" },
};
const liability: LiabilityAck = { acknowledged: true, acceptedAt: "2026-07-16T00:00:00Z" };

const GOOD_CORE = JSON.stringify({
  summary: "A steady plan to build stamina and strength.",
  goals: [
    { label: "Two easy runs a week", kind: "workout" },
    { label: "Stretch for five minutes each evening", kind: "habit" },
    { label: "Three short strength sessions", kind: "workout" },
  ],
});
const GOOD_PROGRAM = JSON.stringify({
  workouts: [
    {
      name: "Full Body A",
      exercises: [
        { name: "Bodyweight Squat", sets: [{ reps: 12, restSec: 45 }] },
        { name: "Push-up", sets: [{ reps: 10, restSec: 45 }] },
      ],
    },
  ],
  benchmark: { exercise: "Bodyweight Squat", metric: "reps", target: 20, unit: "reps" },
});
// createPlan calls the core prompt first, then the program prompt — so
// mockResolvedValueOnce in that order routes cleanly without inspecting args.
beforeEach(() => complete.mockReset());

describe("createPlan (two-phase generation)", () => {
  it("uses AI goals + AI program when both calls succeed", async () => {
    complete.mockResolvedValueOnce(GOOD_CORE).mockResolvedValueOnce(GOOD_PROGRAM);
    const res = await createPlan(input, liability);
    expect(res.usedFallback).toBe(false);
    expect(res.gen.goals.map((g) => g.label)).toContain("Three short strength sessions");
    expect(res.plan.program?.workouts[0]?.workout.name).toBe("Full Body A");
  });

  it("retries the program once and uses the second attempt when the first truncates", async () => {
    const TRUNCATED_PROGRAM = '{"workouts":[{"name":"Full Body A","exercises":[{"name":"Squat","sets":[{"reps":12';
    complete
      .mockResolvedValueOnce(GOOD_CORE)
      .mockResolvedValueOnce(TRUNCATED_PROGRAM)
      .mockResolvedValueOnce(GOOD_PROGRAM);
    const res = await createPlan(input, liability);
    expect(res.usedFallback).toBe(false);
    expect(res.programFallback).toBeUndefined();
    expect(res.plan.program?.workouts[0]?.workout.name).toBe("Full Body A"); // retry won
    // The retry prompt carried the rejection reason forward.
    const retryMsg = (complete.mock.calls[2]![0] as unknown as { messages: { content: string }[] })
      .messages[0]!.content;
    expect(retryMsg).toMatch(/REJECTED for: .*cut off/i);
  });

  it("flags programFallback + attaches the template when BOTH program attempts fail", async () => {
    const TRUNCATED_PROGRAM = '{"workouts":[{"name":"Full Body A","exercises":[{"name":"Squat","sets":[{"reps":12';
    complete
      .mockResolvedValueOnce(GOOD_CORE)
      .mockResolvedValueOnce(TRUNCATED_PROGRAM)
      .mockResolvedValueOnce(TRUNCATED_PROGRAM);
    const res = await createPlan(input, liability);
    expect(res.usedFallback).toBe(false); // AI goals survived
    expect(res.plan.program?.workouts[0]?.workout.name).toBe("Bodyweight Starter"); // template program
    expect(res.programFallback).toBe(true);
    expect(res.programFallbackReason).toMatch(/cut off/i);
  });

  it("falls back with a 'too long' reason when the core JSON is truncated on both attempts", async () => {
    const TRUNCATED_CORE = '{"summary":"A plan","goals":[{"label":"Two easy runs a week","kind":"work';
    complete.mockResolvedValue(TRUNCATED_CORE);
    const res = await createPlan(input, liability);
    expect(res.usedFallback).toBe(true);
    expect(res.failureReason).toMatch(/too long/i);
  });

  it("falls back with a 'no goals' reason when the core has an empty goals array", async () => {
    complete.mockResolvedValue(JSON.stringify({ summary: "hi", goals: [] }));
    const res = await createPlan(input, liability);
    expect(res.usedFallback).toBe(true);
    expect(res.failureReason).toMatch(/didn't include any goals/i);
  });

  it("adds a units directive to the prompt when the user reads imperial", async () => {
    complete.mockResolvedValueOnce(GOOD_CORE).mockResolvedValueOnce(GOOD_PROGRAM);
    await createPlan({ ...input, units: "imperial" }, liability);
    const msg = (complete.mock.calls[0]![0] as unknown as { messages: { content: string }[] }).messages[0]!.content;
    expect(msg).toContain("UNITS: the user reads IMPERIAL");
  });

  it("keeps metric prompts free of the directive, and sends no body stats either way", async () => {
    complete.mockResolvedValueOnce(GOOD_CORE).mockResolvedValueOnce(GOOD_PROGRAM);
    await createPlan({ ...input, units: "metric" }, liability);
    const msg = (complete.mock.calls[0]![0] as unknown as { messages: { content: string }[] }).messages[0]!.content;
    expect(msg).not.toContain("UNITS:");
    expect(msg).not.toMatch(/\b(height|weight|sex|kcal|calories?)\b/i);
    expect(msg).toContain("Workout days per week: 3");
  });

  it("detects truncation from the raw reply even when complete inner objects precede the cut", async () => {
    // extractJson falls back to slicing at the last "}", so the EXTRACTED text ends
    // in "}" here — truncation has to be judged on the raw text.
    const CUT_PROGRAM =
      '{"workouts":[{"name":"Evaluation","exercises":[{"name":"Pull-ups","sets":[{"reps":10,"restSec":60}]},{"name":"Push-ups","sets":[{"reps":20,"rest';
    complete
      .mockResolvedValueOnce(GOOD_CORE)
      .mockResolvedValueOnce(CUT_PROGRAM)
      .mockResolvedValueOnce(GOOD_PROGRAM);
    await createPlan(input, liability);
    const retryMsg = (complete.mock.calls[2]![0] as unknown as { messages: { content: string }[] })
      .messages[0]!.content;
    expect(retryMsg).toMatch(/REJECTED for: .*cut off/i);
  });

  it("reports a core reply cut off after complete goals as 'too long', not invalid JSON", async () => {
    const CUT_CORE =
      '{"summary":"A plan","goals":[{"label":"Two easy runs a week","kind":"workout"},{"label":"Stretch every eve';
    complete.mockResolvedValue(CUT_CORE);
    const res = await createPlan(input, liability);
    expect(res.usedFallback).toBe(true);
    expect(res.failureReason).toMatch(/too long/i);
  });

  it("still reports balanced-but-malformed JSON as invalid JSON, not truncated", async () => {
    complete.mockResolvedValue('{"summary":"A plan","goals":[{"label":"Walk","kind":"habit"},]}');
    const res = await createPlan(input, liability);
    expect(res.usedFallback).toBe(true);
    expect(res.failureReason).toMatch(/valid JSON/i);
  });

  describe("Fitness: no calorie target or nutrition goals", () => {
    const fitInput: PlanInput = { ...input, mode: "get_fit" };

    it("ignores the AI's calorie target and drops nutrition goals for get_fit", async () => {
      const core = JSON.stringify({
        summary: "Get moving.",
        dailyCalorieTarget: 2100,
        goals: [
          { label: "Three short strength sessions", kind: "workout" },
          { label: "Eat protein at every meal", kind: "nutrition" },
          { label: "Stand and stretch every hour", kind: "habit" },
        ],
      });
      complete.mockResolvedValueOnce(core).mockResolvedValueOnce(GOOD_PROGRAM);
      const res = await createPlan(fitInput, liability);
      expect(res.usedFallback).toBe(false);
      expect(res.plan).not.toHaveProperty("targets");
      expect(res.gen).not.toHaveProperty("dailyCalorieTarget");
      expect(res.plan.goals.map((g) => g.kind)).not.toContain("nutrition");
      expect(res.plan.goals).toHaveLength(2);
      // The core prompt doesn't ask for calories or food goals either.
      const sys = (complete.mock.calls[0]![0] as { system: string }).system;
      expect(sys).not.toMatch(/dailyCalorieTarget|nutrition/);
    });
  });

  describe("gated logging_only plans", () => {
    const gated: PlanInput = { ...input, mode: "logging_only" };

    it("tells the model no exercise goals are allowed", async () => {
      complete.mockResolvedValueOnce(JSON.stringify({ summary: "s", goals: [{ label: "Weekly check-in", kind: "habit" }] }));
      await createPlan(gated, liability);
      const msg = (complete.mock.calls[0]![0] as unknown as { messages: { content: string }[] }).messages[0]!.content;
      expect(msg).toMatch(/NO exercise, movement or workout goals/);
    });

    it("rejects an exercise goal the model labelled 'habit' and falls back to non-food, non-exercise goals", async () => {
      complete.mockResolvedValue(
        JSON.stringify({ summary: "s", goals: [{ label: "Go for a 30-minute run every day", kind: "habit" }] }),
      );
      const res = await createPlan(gated, liability);
      expect(res.usedFallback).toBe(true);
      expect(res.failureReason).toMatch(/must not prescribe workouts/);
      expect(res.plan.goals.map((g) => g.kind)).not.toContain("nutrition");
      expect(res.plan.goals.map((g) => g.label).join(" ")).not.toMatch(/\beat\b|food/i);
      expect(res.plan).not.toHaveProperty("targets");
    });
  });

  // (Transport-error → fallback with the thrown message is the pre-existing
  // try/catch path in createPlan, unchanged by the split; a mock that throws
  // trips vitest's uncaught-error guard, so it isn't re-asserted here.)
});

describe("createPlan stores no calorie target", () => {
  // Habit-only goals so the core passes validation for every mode (no fallback).
  const HABIT_CORE = JSON.stringify({
    summary: "Build a steady routine.",
    dailyCalorieTarget: 2000,
    goals: [
      { label: "Log how you feel each day", kind: "habit" },
      { label: "Note your energy each evening", kind: "habit" },
      { label: "Lay out your gear the night before", kind: "habit" },
    ],
  });
  it("drops the AI's calorie number for a logging_only plan", async () => {
    complete.mockResolvedValueOnce(HABIT_CORE);
    const res = await createPlan({ ...input, mode: "logging_only" }, liability);
    expect(res.usedFallback).toBe(false);
    expect(res.plan).not.toHaveProperty("targets");
  });
  it("drops the AI's calorie number for a get_fit plan", async () => {
    complete.mockResolvedValueOnce(HABIT_CORE).mockResolvedValueOnce(GOOD_PROGRAM);
    const res = await createPlan({ ...input, mode: "get_fit" }, liability);
    expect(res.usedFallback).toBe(false);
    expect(res.plan).not.toHaveProperty("targets");
  });
});
