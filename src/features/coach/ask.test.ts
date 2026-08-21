import { describe, it, expect, vi, beforeEach } from "vitest";
import { ASK_SUGGESTIONS } from "./ask";

const complete = vi.fn();
const files: Record<string, string> = {};

vi.mock("../../bridge/ai", async (orig) => ({
  ...(await orig<typeof import("../../bridge/ai")>()),
  complete: (...a: unknown[]) => complete(...a),
  isAiAvailable: () => true,
}));
vi.mock("../../bridge/vfs", () => ({
  readJson: async (p: string, d: unknown) => (files[p] ? JSON.parse(files[p]) : d),
  writeJson: async (p: string, v: unknown) => {
    files[p] = JSON.stringify(v);
  },
}));
vi.mock("../../data/repository", () => ({
  getRepository: async () => ({
    getGoals: async () => ({ calories: 2200, protein: 150, carbs: 200, fat: 70 }),
    getProfile: async () => ({ units: "imperial", weightKg: 81, direction: "lose" }),
  }),
}));

beforeEach(() => {
  complete.mockReset();
  for (const k of Object.keys(files)) delete files[k];
});

describe("askCoach", () => {
  it("answers and never proposes a plan change", async () => {
    const { askCoach } = await import("./ask");
    complete.mockResolvedValue("A medium banana has about 3 g of fiber.");
    const reply = await askCoach("Are bananas high in fiber?");
    expect(reply).toContain("3 g of fiber");
    const req = complete.mock.calls[0]![0] as { system: string };
    expect(req.system).toMatch(/cannot change the user's plan/i);
  });

  it("tells the model the user's own targets so answers can be specific", async () => {
    const { askCoach } = await import("./ask");
    complete.mockResolvedValue("ok");
    await askCoach("What should I snack on?");
    const req = complete.mock.calls[0]![0] as { system: string };
    expect(req.system).toContain("2200 cal");
    expect(req.system).toContain("losing weight");
  });

  it("sends prior turns so follow-ups make sense", async () => {
    const { askCoach } = await import("./ask");
    complete.mockResolvedValue("ok");
    await askCoach("what about the green ones?", [
      { role: "user", content: "are bananas high in fiber?" },
      { role: "assistant", content: "about 3 g" },
    ]);
    const req = complete.mock.calls[0]![0] as { messages: { content: string }[] };
    expect(req.messages).toHaveLength(3);
    expect(req.messages[2]!.content).toBe("what about the green ones?");
  });

  it("returns a readable sentence instead of throwing when the call fails", async () => {
    const { askCoach } = await import("./ask");
    complete.mockRejectedValue(new Error("network"));
    await expect(askCoach("anything?")).resolves.toMatch(/try again/i);
  });

  it("ignores an empty question", async () => {
    const { askCoach } = await import("./ask");
    expect(await askCoach("   ")).toBe("");
    expect(complete).not.toHaveBeenCalled();
  });

  it("round-trips history and caps what it stores", async () => {
    const { loadAskHistory, saveAskHistory } = await import("./ask");
    expect(await loadAskHistory()).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ role: "user" as const, content: `q${i}` }));
    await saveAskHistory(many);
    const back = await loadAskHistory();
    expect(back).toHaveLength(40);
    expect(back[39]!.content).toBe("q49");
  });
});

describe("ASK_SUGGESTIONS", () => {
  it("are real questions, so the placeholder teaches the shape of one", () => {
    expect(ASK_SUGGESTIONS.length).toBeGreaterThan(3);
    expect(ASK_SUGGESTIONS.every((q) => q.trim().endsWith("?"))).toBe(true);
  });
});
