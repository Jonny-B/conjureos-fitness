export type EntryKind = "food" | "exercise";

/** A row of `fitness_entries`. */
export interface Entry {
  id: string;
  entry_date: string; // YYYY-MM-DD
  kind: EntryKind;
  name: string;
  quantity: string | null;
  calories: number; // consumed (food) or burned (exercise), always >= 0
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

/** A parsed-but-not-yet-saved entry returned by the fitness-parse function. */
export type DraftEntry =
  | {
      kind: "food";
      name: string;
      quantity: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
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
