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
// The agreement to keep health data is in force: these tests are about what
// the feature does with the answer. features/aiAgreement.test.ts holds the gate.
vi.mock("../healthConsent", async (orig) => ({
  ...(await orig<typeof import("../healthConsent")>()),
  healthConsentOnFile: async () => true,
  stillCollecting: () => true,
}));

import { createPlan } from "./generate";

const input: PlanInput = {
  mode: "both",
  goalText: "lose a few pounds and feel less winded",
  durationWeeks: 8,
  daysPerWeek: 3,
  experienceLevel: "beginner",
  equipment: "none",
  heightCm: 178,
  weightKg: 80,
  age: 30,
  sex: "male",
  calorieTarget: 1800,
  safety: { ageBand: "18_39", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "light" },
};
const liability: LiabilityAck = { acknowledged: true, acceptedAt: "2026-07-16T00:00:00Z" };

const GOOD_CORE = JSON.stringify({
  summary: "A balanced plan to lose weight and get moving.",
  dailyCalorieTarget: 1800,
  goals: [
    { label: "Stay around 1800 kcal", kind: "nutrition" },
    { label: "Protein at every meal", kind: "nutrition" },
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
// Braces matter: vitest runs a function returned from beforeEach as the
// test's cleanup, and mockReset() returns the mock, so an arrow without them
// called `complete` once more after every test.
beforeEach(() => {
  complete.mockReset();
});

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

  // conjureos-fitness#89: a refusal answers the same way every time, so it is
  // not asked again, and the review says the AI declined rather than failed.
  it("does not ask again after the AI declines the goals", async () => {
    complete.mockRejectedValue(new Error("Claude declined this request."));
    const res = await createPlan(input, liability);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(res.usedFallback).toBe(true);
    expect(res.failureReason).toBe("the AI declined this request");
  });

  it("does not ask again after the AI declines the program", async () => {
    complete
      .mockResolvedValueOnce(GOOD_CORE)
      .mockRejectedValueOnce(new Error("Claude declined this request."));
    const res = await createPlan(input, liability);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(res.usedFallback).toBe(false);
    expect(res.programFallback).toBe(true);
    expect(res.programFallbackReason).toBe("the AI declined this request");
  });

  it("names a cap the AI ran out of, and asks once more (thinking length varies)", async () => {
    complete.mockRejectedValue(
      new Error("The model ran out of room before answering. Try again, or ask for something shorter."),
    );
    const res = await createPlan(input, liability);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(res.failureReason).toBe("the AI ran out of room before it answered");
  });

  it("falls back with a 'too long' reason when the core JSON is truncated on both attempts", async () => {
    const TRUNCATED_CORE = '{"summary":"A plan","goals":[{"label":"Stay around 1800 kcal","kind":"nutri';
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

  it("writes imperial numbers + a units directive into the prompt when the user reads imperial", async () => {
    complete.mockResolvedValueOnce(GOOD_CORE).mockResolvedValueOnce(GOOD_PROGRAM);
    await createPlan({ ...input, units: "imperial", goalWeightKg: 72 }, liability);
    const msg = (complete.mock.calls[0]![0] as unknown as { messages: { content: string }[] }).messages[0]!.content;
    expect(msg).toContain(`5'10"`); // 178 cm
    expect(msg).toContain("176 lb"); // 80 kg
    expect(msg).toContain("159 lb"); // 72 kg goal
    expect(msg).toContain("UNITS: the user reads IMPERIAL");
  });

  it("keeps metric prompts unchanged when the user reads metric", async () => {
    complete.mockResolvedValueOnce(GOOD_CORE).mockResolvedValueOnce(GOOD_PROGRAM);
    await createPlan({ ...input, units: "metric" }, liability);
    const msg = (complete.mock.calls[0]![0] as unknown as { messages: { content: string }[] }).messages[0]!.content;
    expect(msg).toContain("178 cm");
    expect(msg).toContain("80 kg");
    expect(msg).not.toContain("UNITS:");
  });

  // (Transport-error → fallback with the thrown message is the pre-existing
  // try/catch path in createPlan, unchanged by the split; a mock that throws
  // trips vitest's uncaught-error guard, so it isn't re-asserted here.)
});
