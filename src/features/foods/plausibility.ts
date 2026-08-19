/**
 * Sanity checks for nutrition numbers that arrive from someone else — a
 * barcode hit, a search result, an AI parse.
 *
 * Third-party food data is frequently wrong in obvious ways: a decimal point
 * lost in a scrape, grams typed into the calories box, a per-100g figure
 * pasted into a per-serving field. The user notices ("10000 calories for a
 * bag of chips?") long before we do, so the point of this module is to notice
 * FIRST and offer the fix, rather than let an absurd number quietly eat the
 * day's whole budget.
 *
 * Every check is deliberately loose. A false positive costs a banner the user
 * dismisses by logging anyway; a false negative costs a wrecked diary. But
 * loose also means we only fire on numbers that are impossible, not merely
 * surprising — real labels are messy (fiber, sugar alcohols and rounding all
 * push the arithmetic around), and a banner that cries wolf gets ignored.
 */

import type { FoodItem, Macros, Micros } from "../../types";

/** Calories per gram, Atwater general factors. */
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9, alcohol: 7 } as const;

/** Nothing edible is denser than pure fat (9 kcal/g); the headroom absorbs
 *  rounding and the odd fortified-oil outlier. */
const MAX_KCAL_PER_G = 9.5;

/** Ceiling for one serving of anything a person eats in a sitting. Above this
 *  the field is almost certainly a per-package or per-100g figure. */
const MAX_CALORIES_PER_SERVING = 3000;

/** Ceiling for a single macro in one serving, in grams. */
const MAX_MACRO_G = 400;

/** How far the stated calories may drift from the Atwater estimate before we
 *  call it broken. Wide on purpose — see the module note. */
const ATWATER_LOW_RATIO = 0.45;
const ATWATER_HIGH_RATIO = 2;

/** Ignore small absolute gaps entirely: at 30 calories the ratio test is noise. */
const ATWATER_MIN_GAP = 60;

/** Why a food's numbers can't be right. `code` is for logging and tests,
 *  `message` is shown to the user verbatim. */
export interface Implausibility {
  code: "atwater_low" | "atwater_high" | "absurd_calories" | "absurd_macro" | "too_dense" | "mass_exceeds_serving";
  message: string;
}

/** Calories implied by the macros, using Atwater factors. Alcohol counts when
 *  we know it, which keeps spirits and beer from tripping the low check. */
export function atwaterCalories(perServing: Macros, micros?: Micros): number {
  return (
    perServing.protein * KCAL_PER_G.protein +
    perServing.carbs * KCAL_PER_G.carbs +
    perServing.fat * KCAL_PER_G.fat +
    (micros?.alcoholG ?? 0) * KCAL_PER_G.alcohol
  );
}

const round = (n: number): number => Math.round(n);

/**
 * Check a food's per-serving numbers for impossible values.
 *
 * Returns the single most useful problem, or null when nothing is obviously
 * broken. Never throws and never inspects anything but the serving figures, so
 * it is safe to call on every render.
 */
export function checkPlausibility(food: FoodItem): Implausibility | null {
  const p = food.perServing;
  const vals = [p.calories, p.protein, p.carbs, p.fat];
  if (vals.some((v) => !Number.isFinite(v) || v < 0)) return null;

  // Absurd absolutes first — they give the clearest message.
  if (p.calories > MAX_CALORIES_PER_SERVING) {
    return {
      code: "absurd_calories",
      message: `${round(p.calories).toLocaleString()} calories in one serving isn't possible — that figure is probably for the whole case, or the decimal point moved.`,
    };
  }

  const macros: [string, number][] = [
    ["protein", p.protein],
    ["carbs", p.carbs],
    ["fat", p.fat],
  ];
  const bigMacro = macros.find(([, v]) => v > MAX_MACRO_G);
  if (bigMacro) {
    return {
      code: "absurd_macro",
      message: `${round(bigMacro[1])}g of ${bigMacro[0]} in one serving isn't possible.`,
    };
  }

  // Density: calories against the serving's own weight.
  if (food.servingGrams && food.servingGrams > 0) {
    const perGram = p.calories / food.servingGrams;
    if (perGram > MAX_KCAL_PER_G) {
      return {
        code: "too_dense",
        message: `${round(p.calories).toLocaleString()} calories in ${round(food.servingGrams)}g is denser than pure fat, so at least one of those numbers is wrong.`,
      };
    }
    const macroMass = p.protein + p.carbs + p.fat + (food.micros?.alcoholG ?? 0);
    // 1.05 leaves room for label rounding; water and ash mean real foods sit
    // well under their serving weight, so this only fires on nonsense.
    if (macroMass > food.servingGrams * 1.05) {
      return {
        code: "mass_exceeds_serving",
        message: `The macros add up to ${round(macroMass)}g, which is more than the ${round(food.servingGrams)}g serving itself weighs.`,
      };
    }
  }

  // Atwater cross-check. Needs both sides to be meaningful.
  const expected = atwaterCalories(p, food.micros);
  if (expected <= 0 || p.calories <= 0) return null;
  if (Math.abs(p.calories - expected) < ATWATER_MIN_GAP) return null;

  const ratio = p.calories / expected;
  if (ratio > ATWATER_HIGH_RATIO) {
    return {
      code: "atwater_high",
      message: `${round(p.calories).toLocaleString()} calories doesn't match the macros — ${round(p.protein)}g protein, ${round(p.carbs)}g carbs and ${round(p.fat)}g fat work out to about ${round(expected).toLocaleString()}.`,
    };
  }
  if (ratio < ATWATER_LOW_RATIO) {
    return {
      code: "atwater_low",
      message: `${round(p.calories).toLocaleString()} calories looks too low for the macros — ${round(p.protein)}g protein, ${round(p.carbs)}g carbs and ${round(p.fat)}g fat work out to about ${round(expected).toLocaleString()}.`,
    };
  }
  return null;
}
