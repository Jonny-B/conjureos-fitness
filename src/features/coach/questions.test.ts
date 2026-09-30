import { describe, expect, it, vi, beforeEach } from "vitest";

const { complete } = vi.hoisted(() => ({
  complete: vi.fn<(a: { messages: Array<{ content: string }> }) => Promise<string>>(),
}));
vi.mock("../../bridge/ai", async (orig) => ({
  ...(await orig<typeof import("../../bridge/ai")>()),
  complete,
  isAiAvailable: () => true,
}));

import { dayQuestions } from "./questions";

const ids = (qs: Array<{ id: string }>) => qs.map((q) => q.id);

beforeEach(() => {
  complete.mockReset();
  complete.mockResolvedValue("not json"); // force the deterministic fallback
});

describe("dayQuestions — the evening check-in", () => {
  it("asks about the day, missed goals and energy, never about eating", async () => {
    const qs = await dayQuestions({ missedGoals: ["Run 3x"] });
    expect(ids(qs)).toEqual(["d_rating", "d_goals", "d_energy", "d_free"]);
    expect(qs.map((q) => q.text).join(" ")).not.toMatch(/eat|food|logged|calorie/i);
  });

  it("skips the missed-goals question when nothing was missed", async () => {
    const qs = await dayQuestions({ missedGoals: [] });
    expect(ids(qs)).not.toContain("d_goals");
    expect(ids(qs).at(-1)).toBe("d_free");
  });

  it("tells the AI pick which goals were missed, with no calorie figures", async () => {
    complete.mockResolvedValue('["d_rating","d_goals"]');
    await dayQuestions({ missedGoals: ["Run 3x"] });
    const prompt = complete.mock.calls[0]![0].messages[0]!.content;
    expect(prompt).toMatch(/plan goals missed today: Run 3x/);
    expect(prompt).not.toMatch(/kcal/);
  });
});
