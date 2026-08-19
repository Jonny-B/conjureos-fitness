import { describe, it, expect } from "vitest";
import { checkPlausibility, atwaterCalories } from "./plausibility";
import type { FoodItem } from "../../types";

const food = (over: Partial<FoodItem> & { perServing: FoodItem["perServing"] }): FoodItem => ({
  id: "x",
  source: "openfoodfacts",
  name: "Test",
  servingSize: "1 serving",
  ...over,
});

describe("checkPlausibility", () => {
  it("catches the Lay's All Dressed case (10000 cal, macros say ~544)", () => {
    const r = checkPlausibility(
      food({ perServing: { calories: 10000, protein: 7, carbs: 57, fat: 32 } }),
    );
    expect(r?.code).toBe("absurd_calories");
    expect(r?.message).toContain("10,000");
  });

  it("catches a decimal-point slip that stays under the absolute ceiling", () => {
    // 1520 stated vs ~152 real: past the ratio bound, below MAX_CALORIES_PER_SERVING.
    const r = checkPlausibility(
      food({ perServing: { calories: 1520, protein: 2, carbs: 15, fat: 9 } }),
    );
    expect(r?.code).toBe("atwater_high");
    expect(r?.message).toContain("about 149");
  });

  it("catches calories too low for the macros", () => {
    const r = checkPlausibility(
      food({ perServing: { calories: 40, protein: 20, carbs: 30, fat: 20 } }),
    );
    expect(r?.code).toBe("atwater_low");
  });

  it("passes a normal label", () => {
    // Real Lay's chips: 160 cal, 2g P, 15g C, 10g F -> Atwater 158.
    expect(
      checkPlausibility(food({ perServing: { calories: 160, protein: 2, carbs: 15, fat: 10 } })),
    ).toBeNull();
  });

  it("tolerates the fiber/sugar-alcohol gap that makes real labels disagree", () => {
    // A high-fiber bar: label says 190, Atwater says 260. Legitimate, must not fire.
    expect(
      checkPlausibility(food({ perServing: { calories: 190, protein: 10, carbs: 30, fat: 10 } })),
    ).toBeNull();
  });

  it("ignores a small absolute gap on a tiny item", () => {
    // Black coffee-ish: 5 stated vs 0 expected. Ratio is infinite, gap is 5.
    expect(
      checkPlausibility(food({ perServing: { calories: 5, protein: 0, carbs: 1, fat: 0 } })),
    ).toBeNull();
  });

  it("counts alcohol so spirits don't read as impossibly low", () => {
    // A 1.5oz shot: 97 cal, no macros at all except 14g alcohol.
    expect(
      checkPlausibility(
        food({ perServing: { calories: 97, protein: 0, carbs: 0, fat: 0 }, micros: { alcoholG: 14 } }),
      ),
    ).toBeNull();
  });

  it("catches calories denser than pure fat", () => {
    const r = checkPlausibility(
      food({ perServing: { calories: 900, protein: 5, carbs: 5, fat: 8 }, servingGrams: 30 }),
    );
    expect(r?.code).toBe("too_dense");
  });

  it("catches macros that outweigh the serving", () => {
    const r = checkPlausibility(
      food({ perServing: { calories: 200, protein: 40, carbs: 40, fat: 15 }, servingGrams: 30 }),
    );
    expect(r?.code).toBe("mass_exceeds_serving");
  });

  it("catches an absurd single macro", () => {
    const r = checkPlausibility(
      food({ perServing: { calories: 500, protein: 900, carbs: 10, fat: 5 } }),
    );
    expect(r?.code).toBe("absurd_macro");
    expect(r?.message).toContain("protein");
  });

  it("returns null rather than throwing on garbage input", () => {
    expect(
      checkPlausibility(food({ perServing: { calories: NaN, protein: 1, carbs: 1, fat: 1 } })),
    ).toBeNull();
    expect(
      checkPlausibility(food({ perServing: { calories: 100, protein: -5, carbs: 1, fat: 1 } })),
    ).toBeNull();
  });
});

describe("atwaterCalories", () => {
  it("uses 4/4/9 and adds alcohol at 7", () => {
    expect(atwaterCalories({ calories: 0, protein: 10, carbs: 10, fat: 10 })).toBe(170);
    expect(atwaterCalories({ calories: 0, protein: 0, carbs: 0, fat: 0 }, { alcoholG: 10 })).toBe(70);
  });
});
