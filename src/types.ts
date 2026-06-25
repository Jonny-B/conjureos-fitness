/**
 * Domain model shared across Conjure Fitness.
 *
 * Kept narrow and additive — these shapes are persisted (to Supabase rows and
 * to the VFS mock store), so adding optional fields later is cheap but
 * renaming/removing them is a migration. Macros are always grams; energy is
 * always kilocalories ("calories" in US food-label parlance).
 */

// ── Nutrition primitives ─────────────────────────────────────────────

/** The four headline numbers Conjure Fitness tracks against goals. */
export interface Macros {
  /** Energy in kilocalories. */
  calories: number;
  /** Grams of protein. */
  protein: number;
  /** Grams of carbohydrate. */
  carbs: number;
  /** Grams of fat. */
  fat: number;
}

/** Optional micronutrients a food source may provide; all per serving. */
export interface Micros {
  fiber?: number;
  sugar?: number;
  addedSugar?: number;
  saturatedFat?: number;
  transFat?: number;
  cholesterolMg?: number;
  /** Sodium in milligrams. */
  sodium?: number;
  potassiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  vitaminAIu?: number;
  vitaminCMg?: number;
  vitaminDIu?: number;
  alcoholG?: number;
  caffeineMg?: number;
}

/** Where a FoodItem came from + the trust signals attached to it. */
export interface FoodProvenance {
  /** Matches the DB source column: our_db / off_backfill / ai_label / ai_front / user_manual. */
  sourceTag: string;
  aiConfidence?: number;
  isCanonical?: boolean;
  license?: string;
  attributionText?: string;
  warningNote?: string;
}

export const ZERO_MACROS: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

// ── Foods ────────────────────────────────────────────────────────────

export type FoodSource = "openfoodfacts" | "usda" | "custom" | "recipe" | "conjure_health";

/**
 * A food the user can log. Nutrition is expressed **per one serving** of
 * `servingSize`. The diary stores a snapshot of this so edits to the source
 * database (or a deleted recipe) never silently rewrite history.
 */
export interface FoodItem {
  /** Stable id within `source` (barcode, USDA fdcId, recipe slug, or a uuid). */
  id: string;
  source: FoodSource;
  /** Display name, e.g. "Greek Yogurt, plain". */
  name: string;
  /** Brand / manufacturer when known (branded barcode items). */
  brand?: string;
  /** EAN/UPC barcode when the item came from a scan. */
  barcode?: string;
  /** Nutrition for exactly one `servingSize`. */
  perServing: Macros;
  micros?: Micros;
  /** Human label for one serving, e.g. "1 cup (240 g)" or "100 g". */
  servingSize: string;
  /** Grams in one serving when known, so we can offer gram-based quantities. */
  servingGrams?: number;
  provenance?: FoodProvenance;
}

// ── Diary ────────────────────────────────────────────────────────────

export type MealType = "breakfast" | "lunch" | "dinner" | "snacks";

export const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snacks"];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
};

/**
 * One logged food in the diary. Carries a full snapshot of the food so the
 * entry is self-contained and stable. `quantity` is a multiplier on
 * `food.perServing` (1 = one serving, 0.5 = half, 2 = two servings).
 */
export interface DiaryEntry {
  id: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  meal: MealType;
  food: FoodItem;
  quantity: number;
  /** ISO timestamp the entry was created. */
  loggedAt: string;
}

// ── Profile & goals ──────────────────────────────────────────────────

export type Sex = "male" | "female";

export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";

export type GoalDirection = "lose" | "maintain" | "gain";

/**
 * The user's body + activity inputs. Used to derive recommended goals via
 * Mifflin-St Jeor; the user can always override the resulting numbers.
 */
export interface Profile {
  sex: Sex;
  /** Years. */
  age: number;
  /** Centimetres. */
  heightCm: number;
  /** Current weight in kilograms (the goal calc input; weight history is
   *  tracked separately in WeightEntry). */
  weightKg: number;
  activityLevel: ActivityLevel;
  direction: GoalDirection;
  /** Target weight in kilograms (for lose/gain). */
  goalWeightKg?: number;
  /** Display unit preference. Storage is always metric. */
  units: "metric" | "imperial";
}

/**
 * Daily targets. Macro grams are the source of truth; calorie goal should
 * equal 4·protein + 4·carbs + 9·fat but is stored explicitly so a user can
 * pin calories and let macros float (or vice versa).
 */
export interface Goals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const DEFAULT_GOALS: Goals = {
  calories: 2000,
  protein: 120,
  carbs: 200,
  fat: 67,
};

// ── Weight (scaffolded slice) ────────────────────────────────────────

export interface WeightEntry {
  /** YYYY-MM-DD. One canonical entry per day (last write wins). */
  date: string;
  weightKg: number;
}

// ── Fitness / workouts (scaffolded slice) ────────────────────────────

/**
 * Attribution for trainer/coach-authored content. Forward-compatible hook for
 * the planned "fitness coach" ConjureOS user type: licensed trainers author
 * workouts/programs that import into a user's fitness app and display with the
 * coach's name, photo, and credit.
 *
 * Optional everywhere today — built-in seeds and user-made content omit it and
 * nothing depends on it yet. Kept here so the eventual coach feature is purely
 * additive (no migration of the Workout shape). See the GitHub "coach" epic.
 */
export interface CoachProfile {
  /** Stable coach id — a ConjureOS user id once coach accounts exist. */
  id: string;
  /** Display name for the "designed by" credit. */
  name: string;
  /** Headshot/avatar URL or data URL. */
  photoUrl?: string;
  /** Short credential line, e.g. "NASM-CPT · 8 yrs". */
  credentials?: string;
  /** One-paragraph bio for a future coach profile page. */
  bio?: string;
  /** Optional external link (site / booking). */
  link?: string;
  /** True once licensed-trainer status has been verified. */
  verified?: boolean;
}

/** Where a workout came from. Treated as "built-in" when omitted. */
export type WorkoutOrigin = "built-in" | "coach" | "user";

export interface ExerciseSet {
  /** Target reps, or null for a timed set. */
  reps: number | null;
  /** Target seconds for a timed/hold set, or null for a rep set. */
  durationSec: number | null;
  /** Rest after this set, seconds. */
  restSec: number;
  /** Optional target weight in kilograms. */
  weightKg?: number;
}

export interface Exercise {
  id: string;
  name: string;
  sets: ExerciseSet[];
  /** Optional cue shown during the set. */
  notes?: string;
}

export interface Workout {
  id: string;
  name: string;
  /** Short pitch / focus, e.g. "Full-body, 20 min, no equipment". */
  summary?: string;
  exercises: Exercise[];
  /** Provenance — defaults to built-in when omitted. */
  origin?: WorkoutOrigin;
  /** Coach credit, present when origin === "coach". Additive — see CoachProfile. */
  author?: CoachProfile;
}

// ── Derived view models ──────────────────────────────────────────────

/** A day's diary grouped by meal, with totals — computed in features/diary. */
export interface DayView {
  date: string;
  meals: Record<MealType, DiaryEntry[]>;
  perMeal: Record<MealType, Macros>;
  total: Macros;
}
