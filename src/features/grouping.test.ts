import { describe, it, expect } from "vitest";
import { GROUP_NAME_MAX, groupItems, suggestGroupName } from "./naturalLanguage";
import type { FoodItem } from "../types";

const f = (name: string, cal: number, p = 0, c = 0, fat = 0): FoodItem => ({
  id: name, source: "custom", name, servingSize: "1 serving",
  perServing: { calories: cal, protein: p, carbs: c, fat },
});

describe("suggestGroupName", () => {
  it("leads with the biggest item — that's what the meal was", () => {
    // The hotdog is the meal; the bun and mustard are trimmings.
    expect(suggestGroupName([f("Hotdog bun", 120), f("Hotdog", 300), f("Mustard", 5)]))
      .toBe("Hotdog +2 more");
  });

  it("says 'with X' for exactly two", () => {
    expect(suggestGroupName([f("Hotdog", 300), f("Mustard", 5)])).toBe("Hotdog with mustard");
  });

  it("uses the single item's own name", () => {
    expect(suggestGroupName([f("Chicken sandwich", 500)])).toBe("Chicken sandwich");
  });

  it("counts the rest rather than listing them — the sprawl is the point", () => {
    const board = ["Brie", "Cheddar", "Crackers", "Grapes", "Walnuts", "Fig jam"]
      .map((n, i) => f(n, 200 - i));
    const name = suggestGroupName(board);
    expect(name).toBe("Brie +5 more");
    expect(name.length).toBeLessThanOrEqual(GROUP_NAME_MAX);
  });

  it("never exceeds the cap, even with absurd names", () => {
    const long = f("Slow-roasted heritage pork shoulder with apple", 400);
    const other = f("Buttered heritage new potatoes with parsley", 300);
    expect(suggestGroupName([long, other]).length).toBeLessThanOrEqual(GROUP_NAME_MAX);
    expect(suggestGroupName([long, other, f("Gravy", 50)]).length).toBeLessThanOrEqual(GROUP_NAME_MAX);
  });

  it("is empty for nothing", () => {
    expect(suggestGroupName([])).toBe("");
  });
});

describe("groupItems", () => {
  it("sums the macros", () => {
    const one = groupItems([f("Hotdog", 300, 12, 25, 18), f("Mustard", 5, 0, 1, 0)])!;
    expect(one.perServing).toEqual({ calories: 305, protein: 12, carbs: 26, fat: 18 });
  });

  it("labels the serving by count, not a fake '1 serving'", () => {
    expect(groupItems([f("A", 1), f("B", 2), f("C", 3)])!.servingSize).toBe("3 items");
    // A single item keeps its real serving label.
    expect(groupItems([f("A", 1)])!.servingSize).toBe("1 serving");
  });

  it("prefers a supplied name but still caps it", () => {
    expect(groupItems([f("A", 1), f("B", 2)], "Hotdog with mustard")!.name).toBe("Hotdog with mustard");
    const long = groupItems([f("A", 1)], "x".repeat(80))!;
    expect(long.name.length).toBe(GROUP_NAME_MAX);
  });

  it("falls back to a derived name when given a blank one", () => {
    expect(groupItems([f("Hotdog", 300), f("Mustard", 5)], "   ")!.name).toBe("Hotdog with mustard");
  });

  it("stays flagged as an AI estimate so the diary still badges it", () => {
    expect(groupItems([f("A", 1)])!.provenance?.sourceTag).toBe("ai_estimate");
  });

  it("is null for nothing", () => {
    expect(groupItems([])).toBeNull();
  });
});
