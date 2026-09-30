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
 */

import type { DailyCheckoff, Plan, Profile, WorkoutSession } from "../types";
import { readJsonStrict, vfs, writeJson } from "../bridge/vfs";
import type { DayLogPatch, Repository } from "./repository";

const STORE_PATH = "store.json";
/** Device-local authoritative key. App origins partition it per app already,
 *  but the name is explicit for clarity when inspecting devtools storage. */
const LOCAL_KEY = "conjure-fitness:store:v2";

/**
 * v3, holding only what Conjure Fitness uses. Documents written while this code
 * was Conjure Health (and by Fitness 0.1-0.2) also carry a food diary, daily
 * targets, weigh-ins, sleep, water and symptoms. Those belong to Conjure Health,
 * which keeps its own store; nothing here reads them, so they are dropped on
 * load and gone after the next write.
 *
 * Dropping them did NOT bump the version, on purpose: a build that doesn't know
 * a version resets the store to empty, and an older build still open in another
 * window would then write that empty store over everything on its next save.
 * Every build since 0.1.0 reads a v3 document with those slices missing.
 */
interface StoreShape {
  v: 3;
  profile: Profile | null;
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

/** Persist the device-local authoritative copy. Returns whether it actually
 *  landed — a quota error or disabled storage must never THROW into a caller
 *  mid-save (see flush(), which decides success from this return value plus
 *  the VFS mirror's), but the failure can no longer be silently swallowed. */
function writeLocal(store: StoreShape): boolean {
  const ls = localStore();
  if (!ls) return false;
  try {
    ls.setItem(LOCAL_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false; // quota / disabled — the VFS mirror is the fallback
  }
}

/** Mirror write with the same "tell me if it actually landed" contract as
 *  writeLocal(). `writeJson` (used for the best-effort migration write in
 *  init()) intentionally never reports failure; flush() needs to, because a
 *  write is only truly lost when BOTH copies fail. */
async function writeMirror(store: StoreShape): Promise<boolean> {
  try {
    await vfs.write(STORE_PATH, JSON.stringify(store));
    return true;
  } catch {
    // No `window` at all (as opposed to a window with no `__vfs` mounted)
    // means we're not running in a browser tab or WebView at all — every real
    // deployment target of this app has one, so this is specifically the
    // headless/test-harness case, which `vfs`'s own in-memory fallback exists
    // to serve and cannot actually fail (a Map.set can't throw). Report
    // success there rather than letting an unrelated environment gap read as
    // a genuine on-device persistence failure.
    return typeof window === "undefined";
  }
}

/** Drop the device-local copy. Only for a copy known to be stale (a write just
 *  failed and the VFS mirror holds the newer store); removal frees quota and
 *  never throws into the caller. */
function removeLocal(): void {
  try {
    localStore()?.removeItem(LOCAL_KEY);
  } catch {
    /* storage disabled — nothing to remove */
  }
}

/** Subscribe to cross-tab writes of LOCAL_KEY. The `storage` event only fires
 *  in tabs OTHER than the one that wrote, which is exactly what we want: our
 *  own writes already update `this.store` directly. Best-effort — no
 *  `window`/`addEventListener` (SSR, tests, a host without either) just means
 *  this tab's reads go stale until its next mutate(), which re-reads anyway. */
function watchLocalStorage(onChange: (fresh: StoreShape) => void): void {
  try {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key !== LOCAL_KEY || e.newValue == null) return;
      try {
        onChange(migrate(JSON.parse(e.newValue)));
      } catch {
        /* corrupt payload from the other tab — ignore; next mutate() re-reads */
      }
    });
  } catch {
    /* no window / addEventListener unsupported */
  }
}

const EMPTY: StoreShape = {
  v: 3,
  profile: null,
  plan: null,
  dayLogs: {},
  workoutSessions: [],
};

/** The stored profile without the fields a v1-3 store could carry that only
 *  Conjure Health uses (height, goal weight and direction, journal consent). */
function fitnessProfile(p: unknown): Profile | null {
  if (!p || typeof p !== "object") return null;
  const copy = { ...(p as Record<string, unknown>) };
  delete copy.heightCm;
  delete copy.direction;
  delete copy.goalWeightKg;
  delete copy.aiJournalConsent;
  return copy as unknown as Profile;
}

/** The stored plan as a Fitness plan: a food mode reads as its training half,
 *  nutrition goals and calorie targets go. Idempotent: a no-op on a plan this
 *  build saved. */
function fitnessPlan(p: unknown): Plan | null {
  if (!p || typeof p !== "object") return null;
  const plan = { ...(p as Record<string, unknown>) } as Record<string, unknown> & {
    mode?: unknown;
    goals?: unknown;
  };
  if (plan.mode !== "logging_only") plan.mode = "get_fit";
  if (Array.isArray(plan.goals)) {
    plan.goals = plan.goals.filter((g) => (g as { kind?: unknown } | null)?.kind !== "nutrition");
  }
  delete plan.targets;
  return plan as unknown as Plan;
}

/**
 * Normalise whatever was on disk into the current StoreShape. Every known
 * version keeps its profile, plan, check-offs and sessions, and even a
 * current-version document gets its collections normalised: trusting the shape
 * wholesale means one truncated write, hand-edit or partial sync turns every
 * read into "Cannot read properties of undefined", and resetting a corrupt
 * store to EMPTY would discard the slices that ARE intact. Anything else
 * (missing, corrupt, future version) resets to EMPTY.
 */
function migrate(loaded: unknown): StoreShape {
  if (!loaded || typeof loaded !== "object") return structuredClone(EMPTY);
  const doc = loaded as Partial<Omit<StoreShape, "v">> & { v?: number };
  if (doc.v !== 1 && doc.v !== 2 && doc.v !== 3) return structuredClone(EMPTY);
  return {
    v: 3,
    profile: fitnessProfile(doc.profile),
    plan: fitnessPlan(doc.plan),
    dayLogs: doc.dayLogs && typeof doc.dayLogs === "object" ? doc.dayLogs : {},
    workoutSessions: Array.isArray(doc.workoutSessions) ? doc.workoutSessions : [],
    ...(doc.v === 3 && doc.updatedAt ? { updatedAt: doc.updatedAt } : {}),
  };
}

/**
 * The default {@link Repository}: everything lives in one JSON blob held in
 * memory and mirrored to the app's VFS (plus localStorage in the browser), so
 * a fresh checkout runs end-to-end with zero configuration and no network.
 *
 * Reads are served from the in-memory copy; every mutation persists eagerly.
 */
export class MockRepository implements Repository {
  readonly kind = "mock" as const;
  private store: StoreShape = structuredClone(EMPTY);
  /** The last local write failed (quota / disabled), so localStorage holds an
   *  OLDER document than `this.store`. While set, mutate() must build on
   *  `this.store`, not re-read that stale copy. Recomputed by every flush(). */
  private localDirty = false;
  /** init() had no local copy and could not read the VFS store (timeout,
   *  permission, corrupt), so `this.store` is a placeholder, not the user's
   *  data. Writes must not go out until a retry reads it. */
  private storeUnread = false;
  private watching = false;

  async init(): Promise<void> {
    // Registered on every init path (not just first run), so an idle tab's
    // reads follow another tab's writes. Keeps the in-memory copy from going
    // stale: the `storage` event fires in OTHER tabs whenever one of them
    // writes our key. This only helps reads between mutations — every
    // mutate() call below re-reads localStorage itself regardless, which is
    // what actually prevents one tab's write from clobbering another's (see
    // mutate()).
    if (!this.watching) {
      this.watching = true;
      watchLocalStorage((fresh) => {
        this.store = fresh;
      });
    }

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
    let loaded: unknown;
    try {
      loaded = await readJsonStrict<unknown>(STORE_PATH, structuredClone(EMPTY));
    } catch {
      // A failed read is not a missing file. Don't adopt or pin an empty store
      // (that would abandon the synced data and let the first flush overwrite
      // the mirror with it); mutate() retries the read before any write.
      this.storeUnread = true;
      return;
    }
    const before = (loaded as { v?: number } | null)?.v;
    this.store = migrate(loaded);
    writeLocal(this.store);
    // Persist the upgrade immediately so a doc already on the current version
    // doesn't get rewritten every load. Compared against EMPTY.v (the current
    // schema version), not a hardcoded old number, so the next version bump
    // doesn't leave this check silently stale again.
    if (before !== EMPTY.v) await writeJson(STORE_PATH, this.store);
  }

  /** Retry the store read init() could not complete. Resolves once the store
   *  is loaded (from a local copy another tab pinned, or the VFS); throws while
   *  it is still unreadable, so the write fails loudly instead of overwriting. */
  private async recoverUnreadStore(): Promise<void> {
    const local = readLocal();
    if (local) {
      this.store = local;
      this.storeUnread = false;
      return;
    }
    try {
      this.store = migrate(await readJsonStrict<unknown>(STORE_PATH, structuredClone(EMPTY)));
    } catch (err) {
      throw new Error("MockRepository: refusing to save — the stored data could not be read.", {
        cause: err,
      });
    }
    this.storeUnread = false;
  }

  /**
   * Apply a mutation and persist it — the single path every mutator method
   * below goes through instead of poking `this.store` directly and flushing.
   *
   * Two tabs share one localStorage document with no coordination. If a
   * mutator just edited our own (possibly stale) in-memory `this.store` and
   * blind-wrote it, a tab holding an older snapshot could silently erase
   * writes another tab already persisted — e.g. tab A saves a workout and
   * flushes, then tab B, still holding its pre-A snapshot, saves a profile
   * change and flushes ITS snapshot, wiping A's workout with no error. Re-reading
   * the freshest local copy right before applying `fn`, and running `fn`
   * against THAT copy instead of `this.store`, means whatever the other tab
   * already saved is still there when we write — every other slice of the
   * document passes through untouched, and `fn` only edits the slice this call
   * actually cares about. That's last-write-wins per mutation rather than per
   * whole-document, which is all a single-user app opened in two tabs needs;
   * it is deliberately not a CRDT, so two tabs racing to edit the exact same
   * field can still overwrite each other — acceptable for this app.
   *
   * Reads only localStorage here, never the VFS mirror — same reasoning as
   * init(): the synced mirror must never be treated as authoritative.
   */
  private async mutate<T>(fn: (s: StoreShape) => T): Promise<T> {
    if (this.storeUnread) await this.recoverUnreadStore();
    // A failed local write leaves localStorage OLDER than this.store; building
    // on that stale copy would silently drop everything written since.
    const fresh = this.localDirty ? this.store : (readLocal() ?? this.store);
    const result = fn(fresh);
    this.store = fresh;
    await this.flush();
    return result;
  }

  /**
   * Persist the whole store. localStorage is the durable, synchronous,
   * un-syncable source of truth; the VFS write is a best-effort export/mirror
   * (and the dev-server persistence when localStorage is unavailable).
   *
   * A write is only genuinely lost when BOTH copies fail — the VFS mirror is
   * documented (see the class-level comment) as the fallback for exactly this
   * case — so that's the only time this throws. Silently resolving a mutation
   * that landed nowhere was the bug: callers reasonably treat resolution as
   * "this is saved," and it wasn't.
   */
  private async flush(): Promise<void> {
    this.store.updatedAt = new Date().toISOString();
    const localOk = writeLocal(this.store);
    this.localDirty = !localOk;
    const mirrorOk = await writeMirror(this.store);
    // The stale local copy would win on the next init() and hide everything the
    // mirror holds since, so when the mirror has the newer store, drop it (the
    // next init() then seeds from the mirror and re-pins it).
    if (!localOk && mirrorOk) removeLocal();
    if (!localOk && !mirrorOk) {
      throw new Error(
        "MockRepository: failed to persist — both localStorage and the VFS mirror write failed.",
      );
    }
  }

  async getProfile(): Promise<Profile | null> {
    return this.store.profile;
  }

  async saveProfile(profile: Profile): Promise<void> {
    await this.mutate((s) => {
      s.profile = profile;
    });
  }

  async clearWorkoutHistory(): Promise<void> {
    await this.mutate((s) => {
      s.workoutSessions = [];
      s.dayLogs = {};
    });
  }

  async getPlan(): Promise<Plan | null> {
    return this.store.plan;
  }

  async savePlan(plan: Plan): Promise<void> {
    await this.mutate((s) => {
      s.plan = plan;
    });
  }

  async clearPlan(): Promise<void> {
    await this.mutate((s) => {
      s.plan = null;
    });
  }

  async getDayLog(date: string): Promise<DailyCheckoff | null> {
    return this.store.dayLogs[date] ?? null;
  }

  async saveDayLog(date: string, patch: DayLogPatch): Promise<void> {
    await this.mutate((s) => {
      const current = s.dayLogs[date] ?? { date, goalsCompleted: [] };
      s.dayLogs[date] = { ...current, ...patch, date };
    });
  }

  async markCheckoff(goalId: string, date: string, done: boolean): Promise<void> {
    await this.mutate((s) => {
      const current = s.dayLogs[date] ?? { date, goalsCompleted: [] };
      const set = new Set(current.goalsCompleted);
      if (done) set.add(goalId);
      else set.delete(goalId);
      s.dayLogs[date] = { ...current, date, goalsCompleted: [...set] };
    });
  }

  async listWorkoutSessions(limit?: number): Promise<WorkoutSession[]> {
    const sorted = [...this.store.workoutSessions].sort((a, b) =>
      b.completedAt.localeCompare(a.completedAt),
    );
    return limit != null ? sorted.slice(0, limit) : sorted;
  }

  async saveWorkoutSession(session: WorkoutSession): Promise<void> {
    await this.mutate((s) => {
      const idx = s.workoutSessions.findIndex((w) => w.id === session.id);
      if (idx >= 0) s.workoutSessions[idx] = session;
      else s.workoutSessions.push(session);
    });
  }

  async removeWorkoutSession(id: string): Promise<void> {
    await this.mutate((s) => {
      s.workoutSessions = s.workoutSessions.filter((w) => w.id !== id);
    });
  }
}
