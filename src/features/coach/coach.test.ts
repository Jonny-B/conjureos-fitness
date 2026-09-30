import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Plan } from "../../types";
import { EMPTY_MEMORY, type CoachContext } from "./model";

const { complete, remember } = vi.hoisted(() => ({
  complete: vi.fn<() => Promise<string>>(),
  remember: vi.fn(async () => undefined),
}));
vi.mock("./memory", () => ({ remember }));
// Stub only the host-dependent surface; pure helpers (extractJson) stay real.
vi.mock("../../bridge/ai", async (orig) => ({
  ...(await orig<typeof import("../../bridge/ai")>()),
  complete,
  isAiAvailable: () => true,
}));

import { coachChat, evaluateCheckin } from "./coach";
import { STOP_SYMPTOM_REPLY } from "../safety/symptomKeywords";

const plan: Plan = {
  id: "p",
  mode: "get_fit",
  durationWeeks: 4,
  startDate: "2026-07-01",
  endDate: "2026-07-28",
  goals: [],
  safety: { ageBand: "18_39", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "active" },
  liability: { acknowledged: true, acceptedAt: "2026-07-01T00:00:00Z" },
  createdAt: "2026-07-01T00:00:00Z",
  program: {
    workouts: [
      {
        id: "pw",
        workout: {
          id: "w",
          name: "Leg Day",
          exercises: [{ id: "e", name: "Squat", sets: [{ reps: 10, durationSec: null, restSec: 60 }] }],
          origin: "built-in",
        },
        isBenchmark: true,
        benchmarkId: "b",
        benchmarkIds: ["b"],
      },
    ],
    benchmarks: [
      { id: "b", exerciseKey: "squat", name: "Squat", metric: "reps", baseline: 8, target: 20, unit: "reps", history: [] },
    ],
    analysisCursor: 0,
  },
};
const ctx: CoachContext = {
  plan,
  profile: null,
  memory: EMPTY_MEMORY,
  rendered: "Program exercises (use these exact keys): squat.",
};

const PROPOSE = `Sounds like the legs are cooked.
<propose>{ "rationale": "Your last sessions were near-max effort.", "question": "How should we ease off?", "type": "single", "options": [ { "label": "Lighter squats this week" }, { "label": "Swap in lunges" } ] }</propose>`;
const ADJUST = `<adjust>{ "summary": "Lighter squats", "changes": [ { "op": "setReps", "exerciseKey": "squat", "reps": 8 } ] }</adjust>`;

beforeEach(() => {
  complete.mockReset();
  remember.mockClear();
});

describe("coachChat — ask before changing the plan", () => {
  it("surfaces a <propose> as a proposal and does NOT change the plan", async () => {
    complete.mockResolvedValueOnce(PROPOSE);
    const out = await coachChat([{ role: "user", content: "legs are wrecked" }], ctx);
    expect(out.proposal).toBeTruthy();
    expect(out.proposal!.options.map((o) => o.label)).toContain("Lighter squats this week");
    expect(out.planUpdate).toBeUndefined();
    expect(out.reply).not.toContain("<propose>");
  });

  it("applies an <adjust> only when the user is answering a proposal", async () => {
    complete.mockResolvedValueOnce(ADJUST);
    const out = await coachChat([{ role: "user", content: "lighter squats" }], ctx, { answering: true });
    expect(out.planUpdate).toBeTruthy();
    expect(out.planUpdate!.summary).toMatch(/lighter squats/i);
  });

  it("converts a cold <adjust> (not answering) into a confirm proposal — no silent change", async () => {
    complete.mockResolvedValueOnce(ADJUST);
    const out = await coachChat([{ role: "user", content: "how are my legs" }], ctx, { answering: false });
    expect(out.planUpdate).toBeUndefined();
    expect(out.proposal).toBeTruthy();
    expect(out.proposal!.question).toMatch(/apply this change/i);
  });

  it("drops a follow-up proposal once the round budget is spent", async () => {
    complete.mockResolvedValueOnce(PROPOSE);
    const out = await coachChat([{ role: "user", content: "still too hard" }], ctx, {
      answering: true,
      canPropose: false,
    });
    expect(out.proposal).toBeUndefined(); // asked too many times → falls through to prose
  });
});

describe("coachChat — no-op adjustments are not reported as applied", () => {
  const ADJUST_UNKNOWN_KEY = `<adjust>{ "summary": "Lighter squats", "changes": [ { "op": "setReps", "exerciseKey": "Barbell Squat", "reps": 3 } ] }</adjust>`;
  const ADJUST_BENCH_SWAP = `<adjust>{ "summary": "Swap squats", "changes": [ { "op": "swap", "exerciseKey": "squat", "toName": "Lunge" } ] }</adjust>`;

  it("an unmatched exerciseKey gives no planUpdate, no plan_adjusted event, and the 'couldn't apply' reply", async () => {
    complete.mockResolvedValueOnce(ADJUST_UNKNOWN_KEY);
    const out = await coachChat([{ role: "user", content: "lighter squats" }], ctx, { answering: true });
    expect(out.planUpdate).toBeUndefined();
    expect(out.reply).toMatch(/couldn't apply/i);
    expect(out.reply).not.toMatch(/Plan updated/);
    expect(remember).not.toHaveBeenCalledWith(
      expect.objectContaining({ events: [expect.objectContaining({ kind: "plan_adjusted" })] }),
    );
  });

  it("a swap on a benchmark movement (refused by applyAdjustment) is not reported as applied", async () => {
    complete.mockResolvedValueOnce(ADJUST_BENCH_SWAP);
    const out = await coachChat([{ role: "user", content: "swap squats" }], ctx, { answering: true });
    expect(out.planUpdate).toBeUndefined();
    expect(out.reply).not.toMatch(/Plan updated/);
  });

  it("evaluateCheckin: an unmatched adjustment records no plan_adjusted event", async () => {
    complete.mockResolvedValueOnce(
      JSON.stringify({
        reply: "Nice work.",
        notes: [],
        summary: "s",
        adjustment: { summary: "Lighter", changes: [{ op: "setReps", exerciseKey: "Barbell Squat", reps: 3 }] },
      }),
    );
    const out = await evaluateCheckin("workout", [{ id: "w_free", question: "Anything?", value: "tough" }], ctx);
    expect(out.planUpdate).toBeUndefined();
    const events = (remember.mock.calls as unknown as Array<[{ events: Array<{ kind: string }> }]>)[0]![0].events;
    expect(events.map((e) => e.kind)).toEqual(["workout_reflect"]);
  });
});

describe("red-flag symptom screen runs before any model call", () => {
  it("coachChat: a red-flag message gets the fixed reply; no AI call, no change, no memory", async () => {
    const out = await coachChat([{ role: "user", content: "I'm getting chest pain and feel dizzy" }], ctx, {
      answering: true,
    });
    expect(out.reply).toBe(STOP_SYMPTOM_REPLY);
    expect(out.planUpdate).toBeUndefined();
    expect(out.proposal).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it("coachChat: a harmless message containing 'number' still reaches the model", async () => {
    complete.mockResolvedValueOnce("Aim for 12.");
    const out = await coachChat([{ role: "user", content: "what's my target number of reps?" }], ctx);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(out.reply).toBe("Aim for 12.");
  });

  it("coachChat: only the newest user message is screened", async () => {
    complete.mockResolvedValueOnce("Sure.");
    await coachChat(
      [
        { role: "user", content: "my chest pain is gone now" },
        { role: "assistant", content: "Good to hear." },
        { role: "user", content: "how many sets today?" },
      ],
      ctx,
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("evaluateCheckin: a red-flag free-text answer gets the fixed reply; no AI call, no memory", async () => {
    const out = await evaluateCheckin(
      "workout",
      [
        { id: "w_difficulty", question: "How hard?", value: "5/5", scale: 5, metricKey: "workout_difficulty" },
        { id: "w_pain", question: "Any pain?", value: "sharp pain in my chest" },
      ],
      ctx,
    );
    expect(out.reply).toBe(STOP_SYMPTOM_REPLY);
    expect(out.planUpdate).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });
});
