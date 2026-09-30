/**
 * The cross-app actions Conjure Fitness exposes, so ConjureChat and other
 * ConjureOS apps can read the user's training and log a workout done elsewhere:
 *
 *   listWorkouts({ from?, to?, limit? })                              → read
 *   trainingSummary({ date? })                                        → read
 *   nextWorkout()                                                     → read
 *   logWorkout({ durationMin, name?, type?, distanceKm?, calories?, date? }) → write
 *
 * ACTIONS.md is the contract, and the `conjureos.actions` block in package.json
 * is the schema the host checks. `listWorkouts`'s `returns` is also what other
 * apps' `needs` match against (Conjure Health's `workoutSource` feeds its
 * calorie ring from it), and ConjureOS matches FAIL CLOSED: dropping a field
 * from a `required` array, or narrowing a type, disconnects them with no error
 * anywhere. Add fields; never remove or rename one.
 *
 * Deliberately NOT exposed, and not an oversight:
 *
 *   - Plan, goal and program writes. A plan passes the safety intake and the
 *     injury exclusions when it is built; a caller editing one skips both.
 *   - The safety intake itself (age band, pregnancy, cardiac, injuries), coach
 *     memory and check-in answers. None of it is any other app's business.
 *   - GPS breadcrumbs. `listWorkouts` gives a run's distance, never its route.
 *   - Deletes and bulk clears. Irreversible, and no caller need outweighs an
 *     agent wiping someone's training history by mistake.
 *   - Wearable-synced sessions in the read actions. Conjure Health reads Apple
 *     Health itself, so listing them here would count those workouts twice.
 *
 * Reads are side-effect-free and never call AI (a background read must not
 * spend the user's credits). Every action is grant-gated for other apps, reads
 * included: a caller's first call to any of them asks the user once (Allow
 * once / Always / Block), and only the ConjureOS assistant is exempt. A caller's
 * invoke budget should cover that dialog.
 */

import type { ExerciseSet, Plan, WorkoutSession } from "../types";
import { getRepository } from "../data/repository";
import { newId } from "../data/id";
import { shiftDate, todayISO } from "../features/diary";
import { weekToDate } from "../features/exercise";
import { notifyDataChanged } from "../features/dataEvents";
import { sessionMinutes } from "../features/calories";
import { loadPlan } from "../features/plan/planService";
import { currentGroup, isEvaluationGroup, workoutsInGroup } from "../features/plan/groups";
import { fmtSeconds } from "../features/units";
import { asDate, asNonNegInt, asObject, asPositiveAmount, asString } from "./params";

/** Widest date range listWorkouts serves in one call. */
const MAX_RANGE_DAYS = 92;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type Handler = (params?: unknown) => Promise<unknown>;

// ── Shared ───────────────────────────────────────────────────────────

/** Sessions this app recorded: the player, hand entries, and other apps'
 *  logWorkout calls. Wearable syncs are left out (see the header), and so are
 *  benchmark entries: results typed on the Plan tab are recalled numbers, not a
 *  workout done, and would otherwise count as one with an estimated burn. */
function isOwnSession(s: WorkoutSession): boolean {
  return s.source !== "healthkit" && s.source !== "health_connect" && s.source !== "benchmark_entry";
}

/** Rough MET by activity, for a burn estimate when nobody supplied one. */
function metForActivity(activity: string | undefined, cardio: boolean): number {
  const a = (activity ?? "").toLowerCase();
  // Anchored to word starts (and spin/row to word ends): "crunches" is not a
  // run, "arrow" is not a row, "spinal" is not a spin class.
  if (/\brun|\bjog/.test(a)) return 9.8;
  if (/\bcycl|\bbik(e|ing)|\bride|\briding|\bspin(ning)?\b/.test(a)) return 8;
  if (/\bswim/.test(a)) return 7;
  if (/\browing?\b|\brows?\b/.test(a)) return 7;
  if (/hiit|interval|circuit|crossfit/.test(a)) return 8;
  if (/hike/.test(a)) return 6;
  if (/walk/.test(a)) return 3.5;
  if (/yoga|stretch|pilates|mobility/.test(a)) return 3;
  return cardio ? 8 : 5;
}

/**
 * Calories for a session: the stored figure when there is one, else a MET
 * estimate (bodyweight when known, ~6 kcal/min otherwise). Formula only —
 * the in-app flow may ask the AI, but a background read must not.
 */
function burnFor(
  s: WorkoutSession,
  weightKg: number | undefined,
): { kcal: number; estimated: boolean } {
  if (s.caloriesBurned != null && Number.isFinite(s.caloriesBurned)) {
    return { kcal: Math.max(0, Math.round(s.caloriesBurned)), estimated: s.caloriesEstimated === true };
  }
  return { kcal: estimateKcal(sessionMinutes(s), s.activity, !!s.cardio, weightKg), estimated: true };
}

function estimateKcal(
  minutes: number,
  activity: string | undefined,
  cardio: boolean,
  weightKg: number | undefined,
): number {
  if (!(minutes > 0)) return 0;
  const kcal =
    weightKg && weightKg > 0
      ? metForActivity(activity, cardio) * weightKg * (minutes / 60)
      : 6 * minutes;
  return Math.max(0, Math.round(kcal));
}

/** What kind of workout a session was, as a short lowercase word. */
function typeOf(s: WorkoutSession): string {
  if (s.activity) return s.activity.toLowerCase();
  if (s.cardio) return "cardio";
  if ((s.byExercise?.length ?? 0) > 0 || s.planned.length > 0) return "strength";
  return "workout";
}

function nameOf(s: WorkoutSession): string {
  if (s.workoutName) return s.workoutName;
  if (s.activity) return titleCase(s.activity);
  if (s.cardio) return "Cardio";
  return "Workout";
}

function titleCase(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function bodyweightKg(): Promise<number | undefined> {
  const repo = await getRepository();
  const profile = await repo.getProfile().catch(() => null);
  return profile?.weightKg && profile.weightKg > 0 ? profile.weightKg : undefined;
}

// ── listWorkouts ─────────────────────────────────────────────────────

export interface ListedWorkout {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  name: string;
  /** Lowercase activity: "strength", "cardio", or what a caller logged ("yoga"). */
  type: string;
  durationMin: number;
  caloriesBurned: number;
  /** True when caloriesBurned is this app's estimate, not a supplied number. */
  caloriesEstimated: boolean;
  /** ISO timestamp the workout finished. */
  completedAt: string;
  /** Runs and rides only. */
  distanceKm?: number;
}

async function listWorkouts(raw?: unknown): Promise<{ from: string; to: string; workouts: ListedWorkout[] }> {
  const p = raw === undefined ? {} : asObject(raw);
  const to = p.to === undefined || p.to === null ? todayISO() : asDate(p.to, "to");
  let from = p.from === undefined || p.from === null ? shiftDate(to, -6) : asDate(p.from, "from");
  if (from > to) throw new Error("params.from must be on or before params.to");
  // A too-wide range is clamped to the most recent MAX_RANGE_DAYS, not refused.
  const earliest = shiftDate(to, -(MAX_RANGE_DAYS - 1));
  if (from < earliest) from = earliest;
  const limit =
    p.limit === undefined || p.limit === null
      ? DEFAULT_LIMIT
      : asPositiveAmount(p.limit, "limit", 1, MAX_LIMIT, true);

  const repo = await getRepository();
  const [sessions, weightKg] = await Promise.all([
    repo.listWorkoutSessions().catch(() => [] as WorkoutSession[]),
    bodyweightKg(),
  ]);
  const workouts = sessions
    .filter((s) => isOwnSession(s) && s.date >= from && s.date <= to)
    // Newest by workout date, not by when it was recorded: a back-dated entry
    // must not jump ahead of (or push out) a newer-dated workout.
    .sort((a, b) => b.date.localeCompare(a.date) || b.completedAt.localeCompare(a.completedAt))
    .slice(0, limit)
    .map((s): ListedWorkout => {
      const burn = burnFor(s, weightKg);
      return {
        id: s.id,
        date: s.date,
        name: nameOf(s),
        type: typeOf(s),
        durationMin: Math.round(sessionMinutes(s)),
        caloriesBurned: burn.kcal,
        caloriesEstimated: burn.estimated,
        completedAt: s.completedAt,
        ...(s.cardio && s.cardio.distanceKm > 0 ? { distanceKm: round2(s.cardio.distanceKm) } : {}),
      };
    });
  return { from, to, workouts };
}

// ── trainingSummary ──────────────────────────────────────────────────

export interface TrainingSummary {
  /** Monday of the week. */
  weekStart: string;
  /** Last day counted: the date asked about (the week so far). */
  through: string;
  workouts: number;
  activeDays: number;
  activeDates: string[];
  /** The plan's days-per-week target; 0 when there is none. */
  weeklyGoalDays: number;
  minutes: number;
  caloriesBurned: number;
  distanceKm: number;
  hasPlan: boolean;
}

async function trainingSummary(raw?: unknown): Promise<TrainingSummary> {
  const p = raw === undefined ? {} : asObject(raw);
  const date = asDate(p.date);
  if (date > todayISO()) throw new Error("params.date cannot be in the future");
  const days = weekToDate(date);
  const inWeek = new Set(days);

  const repo = await getRepository();
  const [sessions, weightKg, plan] = await Promise.all([
    repo.listWorkoutSessions().catch(() => [] as WorkoutSession[]),
    bodyweightKg(),
    loadPlan(),
  ]);
  const week = sessions.filter((s) => isOwnSession(s) && inWeek.has(s.date));
  const activeDates = days.filter((d) => week.some((s) => s.date === d));
  let minutes = 0;
  let kcal = 0;
  let km = 0;
  for (const s of week) {
    minutes += sessionMinutes(s);
    kcal += burnFor(s, weightKg).kcal;
    km += s.cardio?.distanceKm ?? 0;
  }
  return {
    weekStart: days[0]!,
    through: date,
    workouts: week.length,
    activeDays: activeDates.length,
    activeDates,
    weeklyGoalDays: plan?.weeklyExerciseDays ?? 0,
    minutes: Math.round(minutes),
    caloriesBurned: Math.round(kcal),
    distanceKm: round2(km),
    hasPlan: plan !== null,
  };
}

// ── nextWorkout ──────────────────────────────────────────────────────

export interface NextWorkoutResult {
  hasPlan: boolean;
  /** The plan includes a workout program (logging-only plans do not). */
  hasProgram: boolean;
  /** One line a caller can show or say as-is. */
  message: string;
  /** Absent when there is no program, or the current group is finished. */
  workout?: {
    id: string;
    name: string;
    type: string;
    summary?: string;
    /** A run or ride's goal, e.g. "5 km" or "30 min". */
    target?: string;
    exercises: { name: string; prescription: string }[];
  };
  /** Where the program stands: group number and how much of it is done. */
  group?: number;
  groupDone?: number;
  groupSize?: number;
  /** This group re-tests the plan's benchmarks. */
  evaluation?: boolean;
}

/** "3 × 10 reps" / "4 × 45s" / "1 × 8:00" for an exercise's prescribed sets. */
function prescription(sets: ExerciseSet[]): string {
  if (!sets.length) return "";
  const s = sets[0]!;
  const per =
    s.durationSec != null
      ? fmtSeconds(s.durationSec)
      : s.reps != null
        ? `${s.reps} reps${s.weightKg ? ` @ ${s.weightKg} kg` : ""}`
        : "";
  return per ? `${sets.length} × ${per}` : `${sets.length} sets`;
}

function cardioTarget(t: { distanceKm?: number; durationSec?: number } | undefined): string | undefined {
  if (!t) return undefined;
  if (t.distanceKm && t.distanceKm > 0) return `${round2(t.distanceKm)} km`;
  if (t.durationSec && t.durationSec > 0) return `${Math.round(t.durationSec / 60)} min`;
  return undefined;
}

async function nextWorkout(raw?: unknown): Promise<NextWorkoutResult> {
  if (raw !== undefined) asObject(raw); // takes no params, but refuses junk
  const plan: Plan | null = await loadPlan();
  if (!plan) {
    return {
      hasPlan: false,
      hasProgram: false,
      message: "No training plan yet. Open Conjure Fitness to build one, or pick a workout from its library.",
    };
  }
  const program = plan.mode === "logging_only" ? undefined : plan.program;
  if (!program || program.workouts.length === 0) {
    return {
      hasPlan: true,
      hasProgram: false,
      message: "The current plan has no workout program. Workouts from the library can still be done any time.",
    };
  }
  const group = currentGroup(program);
  const inGroup = workoutsInGroup(program, group);
  const done = inGroup.filter((pw) => pw.completedAt != null).length;
  const evaluation = isEvaluationGroup(program, group);
  const standing = { group, groupDone: done, groupSize: inGroup.length, evaluation };
  const next = inGroup.find((pw) => pw.completedAt == null);
  if (!next) {
    return {
      hasPlan: true,
      hasProgram: true,
      message: `Group ${group} is finished. Open Conjure Fitness to start the next one.`,
      ...standing,
    };
  }
  const w = next.workout;
  const type = w.kind === "run" || w.kind === "bike" ? w.kind : "strength";
  const target = cardioTarget(w.cardioTarget);
  return {
    hasPlan: true,
    hasProgram: true,
    message: `Next up: ${w.name} (${done} of ${inGroup.length} done in group ${group}${evaluation ? ", a benchmark re-test" : ""}).`,
    workout: {
      id: next.id,
      name: w.name,
      type,
      ...(w.summary ? { summary: w.summary } : {}),
      ...(target ? { target } : {}),
      exercises: w.exercises.map((e) => ({ name: e.name, prescription: prescription(e.sets) })),
    },
    ...standing,
  };
}

// ── logWorkout ───────────────────────────────────────────────────────

async function logWorkout(raw?: unknown): Promise<{
  id: string;
  date: string;
  name: string;
  durationMin: number;
  caloriesBurned: number;
  caloriesEstimated: boolean;
}> {
  const p = asObject(raw);
  const durationMin = asPositiveAmount(p.durationMin, "durationMin", 1, 600, true);
  const type = p.type === undefined || p.type === null ? undefined : asString(p.type, "type", 40).toLowerCase();
  const name = p.name === undefined || p.name === null ? undefined : asString(p.name, "name", 60);
  const distanceKm =
    p.distanceKm === undefined || p.distanceKm === null
      ? undefined
      : asPositiveAmount(p.distanceKm, "distanceKm", 0.01, 500);
  const suppliedKcal =
    p.calories === undefined || p.calories === null ? undefined : asNonNegInt(p.calories, "calories", 5000);
  const date = asDate(p.date);
  if (date > todayISO()) throw new Error("params.date cannot be in the future");

  const durationSec = durationMin * 60;
  const estimated = suppliedKcal === undefined;
  const kcal = estimated
    ? estimateKcal(durationMin, type, distanceKm !== undefined, await bodyweightKg())
    : suppliedKcal;
  const session: WorkoutSession = {
    id: newId(),
    date,
    workoutName: name ?? (type ? titleCase(type) : "Workout"),
    planned: [],
    actual: [],
    reprompts: [],
    // A back-dated workout sorts within its own day, not at this moment.
    completedAt: date === todayISO() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString(),
    durationSec,
    caloriesBurned: kcal,
    ...(estimated ? { caloriesEstimated: true } : {}),
    ...(type ? { activity: type } : {}),
    ...(distanceKm !== undefined
      ? {
          cardio: {
            distanceKm,
            durationSec,
            avgPaceSecPerKm: Math.round(durationSec / distanceKm),
            source: "manual" as const,
          },
        }
      : {}),
    source: "logWorkout",
  };
  const repo = await getRepository();
  await repo.saveWorkoutSession(session);
  // Another app's write happens outside React: tell the open screens to re-read.
  notifyDataChanged();
  return {
    id: session.id,
    date,
    name: session.workoutName!,
    durationMin,
    caloriesBurned: kcal,
    caloriesEstimated: estimated,
  };
}

/** The handler map registerActions publishes. Keys must match package.json. */
export const FITNESS_ACTIONS: Record<string, Handler> = {
  listWorkouts,
  trainingSummary,
  nextWorkout,
  logWorkout,
};
