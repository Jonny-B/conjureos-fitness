export type EntryKind = "food" | "exercise";

/** Which meal a food entry belongs to. Null for exercise. */
export type Meal = "breakfast" | "lunch" | "dinner" | "snacks";

export const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snacks"];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
};

/** Best-guess meal slot for the current time of day. */
export const defaultMeal = (d = new Date()): Meal => {
  const h = d.getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snacks";
};

/** A row of `fitness_entries`. */
export interface Entry {
  id: string;
  entry_date: string; // YYYY-MM-DD
  kind: EntryKind;
  meal: Meal | null; // food: which meal; exercise: null
  name: string;
  quantity: string | null;
  calories: number; // consumed (food) or burned (exercise), always >= 0
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

/** A parsed-but-not-yet-saved entry. `meal` is assigned by the logger UI. */
export type DraftEntry =
  | {
      kind: "food";
      name: string;
      quantity: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      meal?: Meal;
    }
  | { kind: "exercise"; name: string; quantity: string; calories: number };

export interface Goals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export const DEFAULT_GOALS: Goals = {
  calories: 2000,
  protein_g: 150,
  carbs_g: 200,
  fat_g: 65,
};

export interface DayTotals {
  consumed: number; // food calories
  burned: number; // exercise calories
  net: number; // consumed - burned
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export type MealTotals = Record<Meal, number>;
