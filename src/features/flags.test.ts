import { describe, it, expect } from "vitest";
import { COACH_AND_WORKOUTS_ENABLED, NUTRITION_ENABLED } from "./flags";
import { HISTORY_ITEMS, visibleHistoryItems } from "./resetData";

/**
 * Which half of the app is on is a product decision, so it gets a test. This
 * repo is Conjure Fitness: workouts and the coach on, food tracking off (that
 * lives in Conjure Health now).
 */
describe("Conjure Fitness feature flags", () => {
  it("has workouts and the coach on", () => {
    expect(COACH_AND_WORKOUTS_ENABLED).toBe(true);
  });

  it("has food and calorie tracking off", () => {
    expect(NUTRITION_ENABLED).toBe(false);
  });

  it("offers the coach + workout reset rows", () => {
    const kinds = visibleHistoryItems().map((i) => i.kind);
    expect(kinds).toContain("coach");
    expect(kinds).toContain("workouts");
  });

  it("keeps every slice clearable", () => {
    // HISTORY_ITEMS is what clearAll walks; hiding a row must never drop a kind.
    const all = HISTORY_ITEMS.map((i) => i.kind);
    expect(all).toContain("coach");
    expect(all).toContain("workouts");
    expect(all).toContain("diary");
  });
});
