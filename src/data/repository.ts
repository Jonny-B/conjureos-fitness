/**
 * Data layer contract.
 *
 * Every screen and feature talks to persistence ONLY through this interface —
 * never to Supabase or the VFS directly. That single seam is what lets the
 * app run identically against three backends:
 *
 *   - `MockRepository`     — in-memory + VFS-persisted. The default. Runs with
 *                            zero configuration, so `npm run dev` and any
 *                            contributor's checkout work end-to-end offline.
 *   - `SupabaseRepository` — real backend (Postgres + RLS + anonymous auth),
 *                            selected when VITE_SUPABASE_URL/ANON_KEY are set.
 *   - (future) a 16c BYO-Backend impl routing through `actions.invoke`.
 *
 * Keeping the contract small and behaviour-identical across impls is the whole
 * point: swap the backend, change nothing above this line.
 */

import type { DiaryEntry, Goals, Profile, WeightEntry } from "../types";
import { getAccessToken, isHostAuthAvailable } from "../bridge/host";

/** Fields the caller supplies when logging; id + loggedAt are assigned here. */
export type NewDiaryEntry = Omit<DiaryEntry, "id" | "loggedAt">;

export interface Repository {
  /** Which backend is live — for diagnostics + a dev badge in the UI. */
  readonly kind: "mock" | "supabase";

  /** Establish a session (anonymous sign-in for Supabase) and warm caches. */
  init(): Promise<void>;

  getProfile(): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<void>;

  getGoals(): Promise<Goals>;
  saveGoals(goals: Goals): Promise<void>;

  /** Diary entries for one calendar date (YYYY-MM-DD). */
  listDiary(date: string): Promise<DiaryEntry[]>;
  addDiaryEntry(entry: NewDiaryEntry): Promise<DiaryEntry>;
  updateDiaryEntry(
    id: string,
    patch: Partial<Pick<DiaryEntry, "quantity" | "meal">>,
  ): Promise<void>;
  removeDiaryEntry(id: string): Promise<void>;

  /** Weight history, newest first. (Scaffold slice — fully wired in mock.) */
  listWeights(): Promise<WeightEntry[]>;
  /** One canonical weight per day; last write wins. */
  upsertWeight(entry: WeightEntry): Promise<void>;
}

// ── Singleton selector ────────────────────────────────────────────────

let instance: Repository | null = null;
let initPromise: Promise<void> | null = null;

function hasSupabaseConfig(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

/**
 * The real backend is used only when ALL of these hold:
 *   1. the shared-project URL + anon key are configured at build time,
 *   2. the host exposes the SSO auth bridge, and
 *   3. that bridge actually yields a session token (user is signed in).
 * Otherwise we use the mock — which is the path for `npm run dev`, a signed-out
 * user, or a host too old to provide identity. Net effect: the app is always
 * usable, and never half-wires a backend it can't authenticate to.
 */
async function shouldUseSupabase(): Promise<boolean> {
  if (!hasSupabaseConfig() || !isHostAuthAvailable()) return false;
  return (await getAccessToken()) !== null;
}

/**
 * Lazily construct + init the right repository. Idempotent — repeated calls
 * return the same initialized instance. The unused backend is dynamically
 * imported so it never enters the parse path of the path we didn't pick.
 */
export async function getRepository(): Promise<Repository> {
  if (instance) {
    if (initPromise) await initPromise;
    return instance;
  }
  if (await shouldUseSupabase()) {
    const { SupabaseRepository } = await import("./supabaseRepository");
    instance = new SupabaseRepository();
  } else {
    const { MockRepository } = await import("./mockRepository");
    instance = new MockRepository();
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info("[nourish] using mock data layer (no shared-project session)");
    }
  }
  initPromise = instance.init();
  await initPromise;
  return instance;
}

/** Test/escape hatch — reset the singleton (used by no production path). */
export function __resetRepository(): void {
  instance = null;
  initPromise = null;
}
