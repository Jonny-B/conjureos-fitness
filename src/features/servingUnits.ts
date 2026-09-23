/**
 * Amount units for logging a food (ConjureOS #475). A food's nutrition is per
 * one `servingSize`; when its gram weight is known the user can instead say how
 * much they had in grams, ounces, millilitres, fluid ounces or cups, and that
 * amount is turned back into the diary's serving multiplier.
 *
 * Volumes assume the density of water (1 ml = 1 g). That is right for coffee,
 * tea, milk and most drinks, and close for soups; the picker says so.
 */

import type { FoodItem, Profile } from "../types";

export type AmountUnit = "serving" | "g" | "oz" | "ml" | "floz" | "cup";

const GRAMS_PER: Record<Exclude<AmountUnit, "serving">, number> = {
  g: 1,
  oz: 28.349523125,
  ml: 1,
  floz: 29.5735295625,
  cup: 236.5882365,
};

export const UNIT_LABELS: Record<AmountUnit, string> = {
  serving: "Servings",
  g: "g",
  oz: "oz",
  ml: "ml",
  floz: "fl oz",
  cup: "cups",
};

/** Volume units, which rely on the water-density assumption. */
export const isVolume = (u: AmountUnit) => u === "ml" || u === "floz" || u === "cup";

/** Units offered for this food, ordered for the user's preference. Only
 *  "serving" when the food's gram weight is unknown. */
export function unitsFor(food: FoodItem, pref: Profile["units"]): AmountUnit[] {
  if (!food.servingGrams || !(food.servingGrams > 0)) return ["serving"];
  return pref === "imperial"
    ? ["serving", "oz", "floz", "cup", "g", "ml"]
    : ["serving", "g", "ml", "oz", "floz", "cup"];
}

/** An amount in `unit` → the serving multiplier stored on the diary entry. */
export function toServings(amount: number, unit: AmountUnit, food: FoodItem): number {
  if (unit === "serving" || !food.servingGrams) return amount;
  return (amount * GRAMS_PER[unit]) / food.servingGrams;
}

/** A serving multiplier → the same amount expressed in `unit`, rounded for
 *  display (whole g/ml, quarter cups, tenths otherwise). */
export function fromServings(servings: number, unit: AmountUnit, food: FoodItem): number {
  if (unit === "serving" || !food.servingGrams) return servings;
  const v = (servings * food.servingGrams) / GRAMS_PER[unit];
  if (unit === "g" || unit === "ml") return Math.round(v);
  if (unit === "cup") return Math.round(v * 4) / 4;
  return Math.round(v * 10) / 10;
}

/** Step for the +/- buttons in each unit. */
export function stepFor(unit: AmountUnit): number {
  if (unit === "g" || unit === "ml") return 10;
  if (unit === "oz" || unit === "floz") return 1;
  return 0.25;
}
