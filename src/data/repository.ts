/**
 * Data layer contract.
 *
 * Every screen and feature talks to persistence ONLY through this interface,
 * never to localStorage or the VFS directly. The one implementation,
 * `MockRepository`, keeps the store on the device (localStorage) with a VFS
 * mirror, and runs with zero configuration, so `npm run dev` and any
 * contributor's checkout work end-to-end offline.
 */

import type { DailyCheckoff, Plan, Profile, WorkoutSession } from "../types";

/** A patch to a day's check-off; `date` is supplied separately. */
export type DayLogPatch = Partial<Omit<DailyCheckoff, "date">>;

/**
 * The persistence contract every screen and feature codes against.
 *
 * Implementations must be behaviourally identical: same ordering, same
 * idempotency, same null-vs-empty semantics. Anything that differs belongs in
 * the doc of the specific method, not in a caller's `if (repo.kind === ...)`.
 */
export interface Repository {
  /** Which backend is live, for diagnostics. */
  readonly kind: "mock";

  /** Load the store and warm caches. */
  init(): Promise<void>;

  /** The user's body + activity inputs, or null before onboarding. */
  getProfile(): Promise<Profile | null>;
  /** Replace the stored profile wholesale. */
  saveProfile(profile: Profile): Promise<void>;

  // ── History resets (Settings → Reset data) ───────────────────────────
  /** Delete all workout sessions + daily check-offs. Destructive; no undo. */
  clearWorkoutHistory(): Promise<void>;

  // ── Plans, daily check-offs and workout sessions ────────────────────

  /** The active plan, or null when the user hasn't created one. */
  getPlan(): Promise<Plan | null>;
  /** Persist the (single) active plan, replacing any existing one. */
  savePlan(plan: Plan): Promise<void>;
  /** Remove the active plan. Day-log history is retained. */
  clearPlan(): Promise<void>;

  /** A day's check-off record, or null when nothing's been ticked yet. */
  getDayLog(date: string): Promise<DailyCheckoff | null>;
  /** Merge a patch into a day's check-off, creating the record if absent. */
  saveDayLog(date: string, patch: DayLogPatch): Promise<void>;
  /** Toggle a single plan goal for a date. Idempotent per (goal, date, done). */
  markCheckoff(goalId: string, date: string, done: boolean): Promise<void>;

  /** Workout sessions, newest first, optionally capped. */
  listWorkoutSessions(limit?: number): Promise<WorkoutSession[]>;
  /** Persist a workout session, replacing one with the same id. */
  saveWorkoutSession(session: WorkoutSession): Promise<void>;
  /** Delete a single workout session by id. Idempotent. */
  removeWorkoutSession(id: string): Promise<void>;
}

// ── Singleton selector ────────────────────────────────────────────────

let instance: Repository | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Lazily construct + init the repository. Idempotent — repeated calls
 * (including concurrent first-calls) return the same initialized instance.
 */
export async function getRepository(): Promise<Repository> {
  if (instance) {
    if (initPromise) await initPromise;
    return instance;
  }
  // Guard concurrent first-calls (App load fans out getProfile/loadPlan):
  // the first sets initPromise, the rest await the same build.
  if (!initPromise) {
    initPromise = buildRepository().then((repo) => {
      instance = repo;
    });
  }
  await initPromise;
  return instance!;
}

async function buildRepository(): Promise<Repository> {
  const { MockRepository } = await import("./mockRepository");
  const repo = new MockRepository();
  await repo.init();
  return repo;
}

/** Test/escape hatch — reset the singleton (used by no production path). */
export function __resetRepository(): void {
  instance = null;
  initPromise = null;
}
