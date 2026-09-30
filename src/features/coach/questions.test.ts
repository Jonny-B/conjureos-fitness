import { describe, expect, it, vi, beforeEach } from "vitest";

const { complete, flags } = vi.hoisted(() => ({
  complete: vi.fn<(a: { messages: Array<{ content: string }> }) => Promise<string>>(),
  flags: { nutrition: false },
}));
vi.mock("../../bridge/ai", async (orig) => ({
  ...(await orig<typeof import("../../bridge/ai")>()),
  complete,
  isAiAvailable: () => true,
}));
vi.mock("../flags", async (orig) => {
  const real = await orig<typeof import("../flags")>();
  return Object.defineProperty({ ...real }, "NUTRITION_ENABLED", { get: () => flags.nutrition, enumerable: true });
});

import { dayQuestions } from "./questions";

const FOOD_IDS = ["d_over", "d_under", "d_nolog"];
const ids = (qs: Array<{ id: string }>) => qs.map((q) => q.id);

beforeEach(() => {
  complete.mockReset();
  complete.mockResolvedValue("not json"); // force the deterministic fallback
});

describe("dayQuestions — food questions follow NUTRITION_ENABLED", () => {
  it("never asks about eating when food can't be logged (calories 0)", async () => {
    flags.nutrition = false;
    const qs = await dayQuestions({ calories: 0, goal: 2000, missedGoals: ["Run 3x"] });
    expect(ids(qs).filter((id) => FOOD_IDS.includes(id))).toEqual([]);
    expect(qs.map((q) => q.text).join(" ")).not.toMatch(/eating|logged|calorie/i);
    expect(ids(qs)).toEqual(["d_rating", "d_goals", "d_energy", "d_free"]);
  });

  it("never asks over/under budget questions from legacy diary data when nutrition is off", async () => {
    flags.nutrition = false;
    expect(ids(await dayQuestions({ calories: 3000, goal: 2000, missedGoals: [] }))).not.toContain("d_over");
    expect(ids(await dayQuestions({ calories: 500, goal: 2000, missedGoals: [] }))).not.toContain("d_under");
  });

  it("omits the kcal clause from the AI pick prompt when nutrition is off", async () => {
    flags.nutrition = false;
    complete.mockResolvedValue('["d_rating","d_goals"]');
    await dayQuestions({ calories: 0, goal: 2000, missedGoals: ["Run 3x"] });
    const prompt = complete.mock.calls[0]![0].messages[0]!.content;
    expect(prompt).not.toMatch(/kcal/);
    expect(prompt).toMatch(/plan goals missed today: Run 3x/);
    expect(prompt).not.toMatch(/d_nolog/);
  });

  it("still asks them when nutrition is on", async () => {
    flags.nutrition = true;
    const qs = await dayQuestions({ calories: 0, goal: 2000, missedGoals: ["Run 3x"] });
    expect(ids(qs)).toContain("d_nolog");
  });
});
