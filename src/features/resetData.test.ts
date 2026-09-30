import { describe, it, expect, vi, beforeEach } from "vitest";
import { HISTORY_ITEMS, clearAllHistories, clearHistory, type HistoryKind } from "./resetData";

const calls: string[] = [];
const repo = {
  clearWorkoutHistory: async () => void calls.push("workouts"),
  clearPlan: async () => void calls.push("plan"),
};
vi.mock("../data/repository", () => ({ getRepository: async () => repo }));
vi.mock("../bridge/vfs", () => ({
  vfs: { rm: async (p: string) => void calls.push(`rm:${p}`) },
}));

beforeEach(() => {
  calls.length = 0;
});

/**
 * The bug this guards: a slice that shipped with storage but no Settings row
 * was unclearable AND survived "Clear all history" — which iterates this very
 * list. Any future slice hits the same trap.
 */
describe("every clearable slice is actually offered", () => {
  it("lists a row for each HistoryKind", () => {
    const listed = new Set(HISTORY_ITEMS.map((i) => i.kind));
    const known: HistoryKind[] = ["workouts", "coach", "coachChat", "planHistory", "plan"];
    for (const k of known) expect(listed.has(k)).toBe(true);
    expect(listed.size).toBe(known.length);
  });

  it("gives every row a label and a description", () => {
    for (const i of HISTORY_ITEMS) {
      expect(i.label.length).toBeGreaterThan(0);
      expect(i.desc.length).toBeGreaterThan(0);
    }
  });

  it("offers nothing that belongs to Conjure Health", () => {
    const copy = HISTORY_ITEMS.map((i) => `${i.label} ${i.desc}`).join(" ");
    expect(copy).not.toMatch(/food|diary|weigh|sleep|water|symptom|journal/i);
  });
});

describe("clearHistory", () => {
  it("clears one slice and leaves the others", async () => {
    await clearHistory("coach");
    expect(calls).toEqual(["rm:coach.json"]);
  });

  it("keeps the workout history when only the current plan goes", async () => {
    await clearHistory("plan");
    expect(calls).toEqual(["plan"]);
  });
});

describe("clearAllHistories", () => {
  it("really does clear everything", async () => {
    await clearAllHistories();
    expect(calls).toContain("workouts");
    expect(calls).toContain("plan");
    // The VFS-backed slices go too.
    expect(calls).toContain("rm:coach.json");
    expect(calls).toContain("rm:coach-chat.json");
    expect(calls).toContain("rm:plan-archive.json");
  });

  it("covers every kind in the list, not a hand-maintained subset", async () => {
    await clearAllHistories();
    expect(calls.length).toBe(HISTORY_ITEMS.length);
  });
});
