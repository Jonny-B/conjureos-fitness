import type { DayTotals, Entry, MealTotals } from "./types";
import { MEALS } from "./types";

export function totalsFor(entries: Entry[]): DayTotals {
  const t: DayTotals = { consumed: 0, burned: 0, net: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const e of entries) {
    if (e.kind === "food") {
      t.consumed += e.calories;
      t.protein_g += e.protein_g ?? 0;
      t.carbs_g += e.carbs_g ?? 0;
      t.fat_g += e.fat_g ?? 0;
    } else {
      t.burned += e.calories;
    }
  }
  t.net = t.consumed - t.burned;
  return round(t);
}

/** Calories per meal slot for the day. */
export function mealTotals(entries: Entry[]): MealTotals {
  const r: MealTotals = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };
  for (const e of entries) {
    if (e.kind === "food" && e.meal) r[e.meal] += e.calories;
  }
  for (const m of MEALS) r[m] = Math.round(r[m]);
  return r;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round = (t: DayTotals): DayTotals => ({
  consumed: Math.round(t.consumed),
  burned: Math.round(t.burned),
  net: Math.round(t.net),
  protein_g: round1(t.protein_g),
  carbs_g: round1(t.carbs_g),
  fat_g: round1(t.fat_g),
});
