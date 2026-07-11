/**
 * Mock data layer — the default backend.
 *
 * Holds everything in memory and mirrors it to a single JSON document in the
 * app's own VFS scope (`store.json`), so a dev reload or a return visit inside
 * ConjureOS keeps your data without any server. This is what makes "clone the
 * repo, `npm run dev`, log a meal" work for contributors with no credentials.
 *
 * Behaviour is intended to match SupabaseRepository exactly — same method
 * contracts, same ordering guarantees — so swapping backends changes nothing
 * above the Repository interface.
 */

import type {
  DailyCheckoff,
  DiaryEntry,
  Goals,
  Plan,
  Profile,
  WeightEntry,
  WorkoutSession,
} from "../types";
import { DEFAULT_GOALS } from "../types";
import { readJson, writeJson } from "../bridge/vfs";
import type { DayLogPatch, NewDiaryEntry, Repository } from "./repository";
import { newId } from "./id";

const STORE_PATH = "store.json";

/** v1: profile/goals/diary/weights only. Retained for the migration path. */
interface StoreShapeV1 {
  v: 1;
  profile: Profile | null;
  goals: Goals | null;
  diary: DiaryEntry[];
  weights: WeightEntry[];
}

/** v2: adds the plan / daily check-off / workout-session slices. */
interface StoreShape {
  v: 2;
  profile: Profile | null;
  goals: Goals | null;
  diary: DiaryEntry[];
  weights: WeightEntry[];
  plan: Plan | null;
  /** Keyed by YYYY-MM-DD. */
  dayLogs: Record<string, DailyCheckoff>;
  workoutSessions: WorkoutSession[];
}

const EMPTY: StoreShape = {
  v: 2,
  profile: null,
  goals: null,
  diary: [],
  weights: [],
  plan: null,
  dayLogs: {},
  workoutSessions: [],
};

/**
 * Normalise whatever was on disk into the current StoreShape. A v1 document is
 * migrated by retaining its slices and synthesising empty v2 fields; anything
 * else (missing, corrupt, future version) resets to EMPTY.
 */
function migrate(loaded: unknown): StoreShape {
  if (!loaded || typeof loaded !== "object") return structuredClone(EMPTY);
  const doc = loaded as { v?: number };
  if (doc.v === 2) return loaded as StoreShape;
  if (doc.v === 1) {
    const v1 = loaded as StoreShapeV1;
    return {
      v: 2,
      profile: v1.profile ?? null,
      goals: v1.goals ?? null,
      diary: v1.diary ?? [],
      weights: v1.weights ?? [],
      plan: null,
      dayLogs: {},
      workoutSessions: [],
    };
  }
  return structuredClone(EMPTY);
}

export class MockRepository implements Repository {
  readonly kind = "mock" as const;
  private store: StoreShape = structuredClone(EMPTY);

  async init(): Promise<void> {
    const loaded = await readJson<unknown>(STORE_PATH, structuredClone(EMPTY));
    const before = (loaded as { v?: number } | null)?.v;
    this.store = migrate(loaded);
    // Persist the upgrade immediately so a v1 doc doesn't re-migrate every load.
    if (before !== 2) await this.flush();
  }

  private async flush(): Promise<void> {
    await writeJson(STORE_PATH, this.store);
  }

  async getProfile(): Promise<Profile | null> {
    return this.store.profile;
  }

  async saveProfile(profile: Profile): Promise<void> {
    this.store.profile = profile;
    await this.flush();
  }

  async getGoals(): Promise<Goals> {
    return this.store.goals ?? { ...DEFAULT_GOALS };
  }

  async saveGoals(goals: Goals): Promise<void> {
    this.store.goals = goals;
    await this.flush();
  }

  async listDiary(date: string): Promise<DiaryEntry[]> {
    return this.store.diary
      .filter((e) => e.date === date)
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  }

  async addDiaryEntry(entry: NewDiaryEntry): Promise<DiaryEntry> {
    const full: DiaryEntry = { ...entry, id: newId(), loggedAt: new Date().toISOString() };
    this.store.diary.push(full);
    await this.flush();
    return full;
  }

  async updateDiaryEntry(
    id: string,
    patch: Partial<Pick<DiaryEntry, "quantity" | "meal">>,
  ): Promise<void> {
    const e = this.store.diary.find((x) => x.id === id);
    if (!e) return;
    if (patch.quantity !== undefined) e.quantity = patch.quantity;
    if (patch.meal !== undefined) e.meal = patch.meal;
    await this.flush();
  }

  async removeDiaryEntry(id: string): Promise<void> {
    this.store.diary = this.store.diary.filter((x) => x.id !== id);
    await this.flush();
  }

  async listWeights(): Promise<WeightEntry[]> {
    return [...this.store.weights].sort((a, b) => b.date.localeCompare(a.date));
  }

  async upsertWeight(entry: WeightEntry): Promise<void> {
    const existing = this.store.weights.find((w) => w.date === entry.date);
    if (existing) existing.weightKg = entry.weightKg;
    else this.store.weights.push(entry);
    await this.flush();
  }

  // ── v2: plans + daily check-off + coached sessions ──────────────────

  async getPlan(): Promise<Plan | null> {
    return this.store.plan;
  }

  async savePlan(plan: Plan): Promise<void> {
    this.store.plan = plan;
    await this.flush();
  }

  async clearPlan(): Promise<void> {
    this.store.plan = null;
    await this.flush();
  }

  async getDayLog(date: string): Promise<DailyCheckoff | null> {
    return this.store.dayLogs[date] ?? null;
  }

  async saveDayLog(date: string, patch: DayLogPatch): Promise<void> {
    const current = this.store.dayLogs[date] ?? { date, goalsCompleted: [] };
    this.store.dayLogs[date] = { ...current, ...patch, date };
    await this.flush();
  }

  async markCheckoff(goalId: string, date: string, done: boolean): Promise<void> {
    const current = this.store.dayLogs[date] ?? { date, goalsCompleted: [] };
    const set = new Set(current.goalsCompleted);
    if (done) set.add(goalId);
    else set.delete(goalId);
    this.store.dayLogs[date] = { ...current, date, goalsCompleted: [...set] };
    await this.flush();
  }

  async listWorkoutSessions(limit?: number): Promise<WorkoutSession[]> {
    const sorted = [...this.store.workoutSessions].sort((a, b) =>
      b.completedAt.localeCompare(a.completedAt),
    );
    return limit != null ? sorted.slice(0, limit) : sorted;
  }

  async saveWorkoutSession(session: WorkoutSession): Promise<void> {
    const idx = this.store.workoutSessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) this.store.workoutSessions[idx] = session;
    else this.store.workoutSessions.push(session);
    await this.flush();
  }
}
