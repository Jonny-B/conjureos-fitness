/**
 * Domain model shared across Conjure Fitness.
 *
 * Kept narrow and additive — these shapes are persisted (to the device store and
 * its VFS mirror), so adding optional fields later is cheap but renaming or
 * removing them is a migration. Energy is always kilocalories.
 */

// ── Profile ─────────────────────────────────────────────────────────

/** Biological sex, used to personalise generated programs. `not_shared` = undisclosed. */
export type Sex = "male" | "female" | "not_shared";

/** Day-to-day activity outside deliberate training. Seeds the wizard's
 *  suggested training days per week for plans that don't store their own. */
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";

/** How much training background the user has — tunes workout difficulty. */
export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

/**
 * The user's body + activity inputs: they personalise generated programs and
 * turn a workout's duration into a calorie-burn estimate.
 */
export interface Profile {
  sex: Sex;
  /** Years. */
  age: number;
  /** Bodyweight in kilograms, for burn estimates. Asked in the plan wizard. */
  weightKg: number;
  activityLevel: ActivityLevel;
  /** Training background — tunes generated workout difficulty. */
  experienceLevel?: ExperienceLevel;
  /** Display unit preference. Storage is always metric. */
  units: "metric" | "imperial";
  /** Guided-setup progress. Absent ⇒ setup never started. Additive; rides
   *  saveProfile. */
  setup?: ProfileSetup;
}

/** Which steps of the guided profile setup the user has completed. */
export interface ProfileSetup {
  completedSteps: string[];
}

/** Fallback body/activity inputs when none have been entered yet. Shared by the
 *  settings editor and the plan service's profile reconciliation. */
export const DEFAULT_PROFILE: Profile = {
  sex: "female",
  age: 30,
  weightKg: 70,
  activityLevel: "moderate",
  units: "metric",
};

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

/** One prescribed set. Exactly one of `reps`/`durationSec` is non-null:
 *  reps for countable work, durationSec for holds and timed intervals. */
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

/** One movement within a workout, plus its prescribed sets. */
export interface Exercise {
  id: string;
  name: string;
  sets: ExerciseSet[];
  /** Optional cue shown during the set. */
  notes?: string;
  /** Inline explainer override; otherwise resolved by key (see ExerciseExplainer). */
  explainer?: ExerciseExplainer;
}

/**
 * How-to / muscles-worked / useful-data for an exercise. Resolved by
 * `exerciseKey` from a layered source: the user's own VFS note first, then a
 * trainer/DB entry (when trainers exist), then an AI-generated + cached one.
 */
export interface ExerciseExplainer {
  exerciseKey: string;
  /** Step-by-step how-to. */
  howTo: string;
  /** Primary muscles worked. */
  worksMuscles?: string[];
  /** Tips, typical ranges, common mistakes. */
  usefulData?: string;
  source: "user" | "coach" | "ai";
  /** Set when source === "coach". */
  author?: CoachProfile;
  /** ISO timestamp — set for AI-generated entries so the cache can age out. */
  cachedAt?: string;
}

/** Workout modality. Absent ⇒ "strength" (the guided step player); cardio
 *  kinds route to the distance tracker instead of buildSteps. */
export type WorkoutKind = "strength" | "run" | "bike";

/** A complete workout: a named, ordered list of exercises the player runs. */
export interface Workout {
  id: string;
  name: string;
  /** Short pitch / focus, e.g. "Full-body, 20 min, no equipment". */
  summary?: string;
  /** Longer overview shown on the pre-workout splash — what it trains, who
   *  it's for, how to approach it. Falls back to `summary` when absent. */
  description?: string;
  exercises: Exercise[];
  /** Modality — absent means strength (back-compat with the built-in seeds). */
  kind?: WorkoutKind;
  /** For cardio kinds: an optional distance/time goal shown during the run. */
  cardioTarget?: { distanceKm?: number; durationSec?: number };
  /** Provenance — defaults to built-in when omitted. */
  origin?: WorkoutOrigin;
  /** Coach credit, present when origin === "coach". Additive — see CoachProfile. */
  author?: CoachProfile;
}

// ── v2: plans, check-off, coached sessions ───────────────────────────
//
// These persist in the on-device store (owner call, DECISIONS 2026-06-24). All
// shapes are additive and self-contained so Phase 9 platform sync can back the
// JSON up as-is.

/**
 * How a plan is oriented. `logging_only` is the safety fallback: the intake
 * gate (under-18 / pregnant / cardiac) forces it, hiding the workout surface.
 */
export type PlanMode = "get_fit" | "logging_only";

/** Coarse age bands — we never store an exact DOB for the safety intake. */
export type AgeBand = "under_18" | "18_39" | "40_59" | "60_plus";

/**
 * The short safety questionnaire captured at wizard step 2. Drives the intake
 * gate (layer 1) and the injury-region exclusion list (layer 2). Deliberately
 * coarse: bands and booleans, no medical detail.
 */
export interface SafetyIntake {
  ageBand: AgeBand;
  /** Currently pregnant or postpartum — forces logging_only. */
  pregnant: boolean;
  /** Any cardiac condition / doctor advisory — forces logging_only. */
  cardiacFlag: boolean;
  /** Injury regions to exclude movements for (keys into the exclusion map). */
  injuries: string[];
  /** Self-reported baseline, reuses the profile scale. */
  activityLevel: ActivityLevel;
}

/**
 * One trackable item in a plan — the unit a DailyCheckoff ticks off. Ids are
 * stable within a plan so check-off history references survive a reload.
 */
export interface PlanGoal {
  id: string;
  /** User-facing line, e.g. "20-min workout" or "Stretch after every session". */
  label: string;
  kind: "workout" | "habit";
  /** Optional machine detail (the movements for a workout goal) for future automation. */
  detail?: string;
}

/**
 * Liability acknowledgement. The timestamp is the audit record for the
 * first-run "I understand" acceptance; lives on the plan (`plan.json.liability`).
 */
export interface LiabilityAck {
  acknowledged: boolean;
  /** ISO timestamp of acceptance. */
  acceptedAt: string;
  /** App version at acceptance, for audit. */
  appVersion?: string;
}

/**
 * What a benchmark measures. Determines how a finished session's result maps to
 * a single comparable number, and (with `lowerIsBetter`) which direction counts
 * as improvement.
 */
export type BenchmarkMetric = "reps" | "weightKg" | "durationSec" | "distanceKm";

/** One measurement of a benchmark over time. */
export interface BenchmarkPoint {
  value: number;
  /** ISO timestamp. */
  at: string;
  /** The WorkoutSession this measurement came from. */
  sessionId?: string;
}

/**
 * A measurable baseline the plan is built to improve — the heart of the
 * adaptive loop. `baseline` is null until the benchmark workout is first
 * completed; that completion sets `baseline` and pushes the first `history`
 * point. `target` is the value to reach. For most metrics higher is better;
 * a timed effort over a fixed distance sets `lowerIsBetter`.
 */
export interface Benchmark {
  id: string;
  /** Exercise this benchmark tracks — normalized join key to sessions. */
  exerciseKey: string;
  /** Display name of the tracked effort. */
  name: string;
  metric: BenchmarkMetric;
  /** First measured value; null until the benchmark session finishes. */
  baseline: number | null;
  /** The value to reach (improvement goal). */
  target: number;
  /** Display unit, e.g. "reps", "kg", "min", "km". */
  unit: string;
  /** True when a smaller number is the improvement (e.g. a timed distance). */
  lowerIsBetter?: boolean;
  /** ISO timestamp of the baseline measurement. */
  measuredAt?: string;
  /** All measurements, oldest first. */
  history: BenchmarkPoint[];
}

/** One workout within a program, optionally the benchmark-measuring one. */
export interface ProgramWorkout {
  id: string;
  workout: Workout;
  /** True when finishing this workout measures one or more benchmarks. */
  isBenchmark?: boolean;
  /** Which Benchmark this workout measures (Benchmark.id). Kept for back-compat;
   *  new plans use `benchmarkIds` (a single assessment can measure several). */
  benchmarkId?: string;
  /** All Benchmarks this workout measures — an assessment can set several
   *  baselines at once (e.g. Murph: pull-ups + push-ups + run). Additive;
   *  when absent, `benchmarkId` (if any) is the single measured benchmark. */
  benchmarkIds?: string[];
  /**
   * Which group this workout belongs to (1-based). Group 1 is the evaluation
   * group; training groups follow. Absent on pre-groups plans — derived as
   * group 1 for benchmark/assessment workouts, group 2 otherwise.
   */
  group?: number;
  /** ISO timestamp the user finished (or manually checked off) this workout
   *  within its group. Cleared on clones when a new group is built. */
  completedAt?: string;
}

/**
 * A structured workout program attached to a Plan (get_fit). Additive —
 * absent for logging_only and all pre-W4 plans. `analysisCursor`
 * is the session count at the last AI adaptation pass (W5).
 */
export interface WorkoutProgram {
  workouts: ProgramWorkout[];
  benchmarks: Benchmark[];
  /** Sessions logged when the adaptation engine last ran (W5). */
  analysisCursor?: number;
  /**
   * The group the user is currently working through (see ProgramWorkout.group).
   * Groups replace "weeks" — no dates, no falling behind: finish the group,
   * start the next. Absent on pre-groups plans; derived there (evaluation group
   * until every benchmark has a baseline, else the first training group).
   */
  currentGroup?: number;
  /**
   * How many groups make one cycle. The first group of every cycle is an
   * EVALUATION group (re-test the benchmarks); the rest are training groups.
   * Defaults to 4 (evaluation + 3 training groups).
   */
  groupsPerCycle?: number;
}

/**
 * A finite 1–4 week plan. At most one is active at a time (`getPlan` returns it
 * or null). Generated by the wizard, validated by the safety layers, then
 * persisted whole so history never silently rewrites.
 */
export interface Plan {
  id: string;
  mode: PlanMode;
  /** 1–4. */
  durationWeeks: number;
  /** Inclusive start, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive end, YYYY-MM-DD. */
  endDate: string;
  goals: PlanGoal[];
  safety: SafetyIntake;
  liability: LiabilityAck;
  /** ISO timestamp the plan was created. */
  createdAt: string;
  /** The free-text goal the user typed in the wizard ("get better at the half
   *  Murph"). Additive — absent on pre-1.17 plans; the plan-edit diff then can't
   *  compare goal text for those and only mode/start-date fork a new plan. */
  goalText?: string;
  /**
   * How many DAYS a week the user wants to move, or absent/0 for "don't track
   * it". Deliberately days rather than sessions: "three times a week" is how
   * people say it, and counting sessions would double-count the same effort
   * when a wearable and a manual entry both land (which they do — see
   * features/exercise, where the two ADD together on purpose).
   *
   * Additive; absent on every plan before this shipped.
   */
  weeklyExerciseDays?: number;
  /** Structured, adaptive workout program. Absent on a logging_only plan. */
  program?: WorkoutProgram;
}

/**
 * A single day's plan progress: which plan goals were ticked, the evening
 * check-in, and the day's wearable-workout corrections.
 */
export interface DailyCheckoff {
  /** YYYY-MM-DD. */
  date: string;
  /** Ids of PlanGoals completed this day. */
  goalsCompleted: string[];
  /** The evening "how did your day go?" coach check-in, once submitted. */
  checkin?: DayCheckin;
  /** Wearable/Apple-Health workouts the user removed from THIS day's exercise
   *  total. Keyed by `${start}-${workoutType}` (HealthKit gives no id). We can't
   *  delete from Apple Health, so we exclude locally (reversible). Additive. */
  excludedWearableKeys?: string[];
  /** Per-wearable-workout calorie overrides (same key), when the user edited the
   *  burned number. Additive/optional. */
  wearableKcalOverrides?: Record<string, number>;
}

/** A submitted end-of-day check-in — the answers as shown, verbatim. */
export interface DayCheckin {
  /** ISO timestamp of submission. */
  at: string;
  answers: { question: string; answer: string }[];
}

/** One mid-session "Tell coach" exchange logged on a WorkoutSession. */
export interface CoachReprompt {
  /** ISO timestamp. */
  at: string;
  /** What the user told the coach. */
  userText: string;
  /** The coach's adjustment / reply. */
  coachText: string;
  /** True when the symptom classifier (layer 3) ended the session here. */
  endedSession?: boolean;
}

/**
 * One recorded set. Timestamps bound the set so a "slow set" (the adaptation
 * engine's key signal) is derivable as completedAt − startedAt vs the
 * prescribed duration. All metric fields optional so a single shape covers
 * rep, timed, and weighted sets.
 */
export interface SetActual {
  reps?: number;
  weightKg?: number;
  durationSec?: number;
  /** Subjective exertion, 1–10 (RPE), when the user records it. */
  rpe?: number;
  /** ISO timestamp the set became active. */
  startedAt: string;
  /** ISO timestamp the user marked it done. */
  completedAt: string;
  /** Actual rest taken after this set, seconds. */
  restActualSec?: number;
}

/** A workout's recorded sets for one exercise, keyed for cross-session joins. */
export interface ExerciseActual {
  /** Normalized exercise name — the join key across sessions + explainers. */
  exerciseKey: string;
  /** Display name as prescribed. */
  name: string;
  sets: SetActual[];
}

/** Recorded result of a cardio (run/bike) session. */
export interface CardioActual {
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm?: number;
  /** Where the distance came from. */
  source: "gps" | "steps" | "manual";
  /** Per-km split times, seconds. */
  splits?: number[];
  /** Raw GPS breadcrumb when tracked (t = epoch ms). */
  track?: { lat: number; lon: number; t: number; accuracy?: number }[];
}

/**
 * A completed (or abandoned) workout run. `planned`/`actual` are the legacy
 * flat snapshots (kept populated for back-compat); the structured
 * `byExercise` (strength) and `cardio` fields are the v2 record. Readers prefer
 * the structured fields when present.
 */
export interface WorkoutSession {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  /** The Workout this session was based on, when it came from the library. */
  workoutId?: string;
  /** Display name of the workout, for the "completed today" list. Additive. */
  workoutName?: string;
  planned: ExerciseSet[];
  actual: ExerciseSet[];
  reprompts: CoachReprompt[];
  /** Structured strength result — recorded sets grouped by exercise. */
  byExercise?: ExerciseActual[];
  /** Structured cardio result, for run/bike sessions. */
  cardio?: CardioActual;
  /** Set when this session was a benchmark run (links to Plan benchmark). */
  benchmarkId?: string;
  /** Benchmarks this session measured, when it was an assessment covering
   *  several (e.g. a Murph test). Union'd with `benchmarkId` at fold-in. */
  benchmarkIds?: string[];
  /** ISO timestamp the session finished. */
  completedAt: string;
  /** Wall-clock length of the session in seconds (start → finish). Additive —
   *  absent on pre-1.18 sessions; used to estimate calories burned. Cardio also
   *  carries duration on `cardio.durationSec`. */
  durationSec?: number;
  /** Active energy burned, kcal — from a manual log, another app's logWorkout,
   *  or the in-app post-workout estimate. Other apps read it through
   *  listWorkouts (Conjure Health adds it to its calorie ring). Additive/optional. */
  caloriesBurned?: number;
  /** Where the session came from. Absent = in-app player (default).
   *  "benchmark_entry" = results typed in on the Plan tab: not a performed workout. */
  source?: "manual" | "healthkit" | "health_connect" | "logWorkout" | "benchmark_entry";
  /** Free-text activity a caller named when logging it from another app
   *  ("running", "yoga"). Additive; absent on sessions from the player. */
  activity?: string;
  /** True when `caloriesBurned` is this app's estimate rather than a number
   *  the user, a wearable or the calling app supplied. Additive. */
  caloriesEstimated?: boolean;
}
