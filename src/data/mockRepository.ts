/**
 * Mock data layer — the default backend.
 *
 * Holds everything in memory and persists it two ways:
 *
 *  1. **`localStorage` (authoritative).** The device-local source of truth.
 *     Each app runs on its own origin (desktop `<slug>.conjureos.app`, mobile
 *     `<slug>.mobile.conjureos.app`), so this is app-private and survives an
 *     iframe/WebView reload — AND it is NOT part of ConjureOS cloud file-sync.
 *     That last property is the whole point: a value you entered on a device
 *     can never be silently reverted by a stale cloud pull, nor by another
 *     open surface blind-flushing its own stale copy of the store.
 *
 *  2. **VFS `store.json` (best-effort mirror).** Still written on every change
 *     so `npm run dev` reloads work with no localStorage, and so a brand-new
 *     device can seed itself from whatever last synced. It is NEVER read back
 *     as authoritative once a device-local copy exists — reading it back is
 *     what let a stale synced blob revert on-device data.
 *
 * Why this split exists: the store is one JSON document, and the mock flushes
 * the WHOLE document on every write. When that document is a single cloud-
 * synced file edited from multiple live surfaces, whole-file last-write-wins
 * means the last blind-flusher clobbers every field — so a units change on one
 * device gets reverted the moment another (stale) surface writes anything.
 * Pinning the truth to un-synced localStorage removes that failure class
 * without changing the platform's sync approach. Cross-device propagation is
 * therefore best-effort (seed-on-first-run), not live — a deliberate, data-loss-
 * averse trade.
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
/** Device-local authoritative key. App origins partition it per app already,
 *  but the name is explicit for clarity when inspecting devtools storage. */
const LOCAL_KEY = "conjure-fitness:store:v2";

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
  /** Wall-clock of the last local write. Informational (aids debugging and any
   *  future explicit cross-device merge); not used for reconciliation today. */
  updatedAt?: string;
}

/** Guarded access to `localStorage` — absent in SSR/tests, or throwing when a
 *  browser has storage disabled (private mode, blocked third-party storage). */
function localStore(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Read the device-local authoritative copy, or null when absent/unreadable. */
function readLocal(): StoreShape | null {
  const ls = localStore();
  if (!ls) return null;
  try {
    const raw = ls.getItem(LOCAL_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist the device-local authoritative copy. Best-effort — a quota error or
 *  disabled storage must never throw into a caller mid-save. */
function writeLocal(store: StoreShape): void {
  const ls = localStore();
  if (!ls) return;
  try {
    ls.setItem(LOCAL_KEY, JSON.stringify(store));
  } catch {
    /* quota / disabled — the VFS mirror is the fallback */
  }
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
    // Device-local copy wins whenever it exists: it's the authoritative store
    // and — crucially — it is NOT cloud-synced, so it can't have been reverted
    // by a stale pull or another surface's blind whole-store flush. We do NOT
    // consult the (synced) VFS store.json here even if it looks newer: adopting
    // it is precisely how a stale synced blob used to clobber on-device data.
    const local = readLocal();
    if (local) {
      this.store = local;
      return;
    }

    // First run on this device (no local copy): seed from the VFS mirror, which
    // may carry data synced from another device on install. Migrate, adopt, and
    // pin it locally so every subsequent load is device-authoritative.
    const loaded = await readJson<unknown>(STORE_PATH, structuredClone(EMPTY));
    const before = (loaded as { v?: number } | null)?.v;
    this.store = migrate(loaded);
    writeLocal(this.store);
    // Persist the upgrade immediately so a v1 doc doesn't re-migrate every load.
    if (before !== 2) await writeJson(STORE_PATH, this.store);
  }

  /**
   * Persist the whole store. localStorage is the durable, synchronous,
   * un-syncable source of truth; the VFS write is a best-effort export/mirror
   * (and the dev-server persistence when localStorage is unavailable).
   */
  private async flush(): Promise<void> {
    this.store.updatedAt = new Date().toISOString();
    writeLocal(this.store);
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
    patch: Partial<Pick<DiaryEntry, "quantity" | "meal" | "food">>,
  ): Promise<void> {
    const e = this.store.diary.find((x) => x.id === id);
    if (!e) return;
    if (patch.quantity !== undefined) e.quantity = patch.quantity;
    if (patch.meal !== undefined) e.meal = patch.meal;
    if (patch.food !== undefined) e.food = patch.food;
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

  async clearDiary(): Promise<void> {
    this.store.diary = [];
    await this.flush();
  }

  async clearWeights(): Promise<void> {
    this.store.weights = [];
    await this.flush();
  }

  async clearWorkoutHistory(): Promise<void> {
    this.store.workoutSessions = [];
    this.store.dayLogs = {};
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
