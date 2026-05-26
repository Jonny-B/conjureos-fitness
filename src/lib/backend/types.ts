/**
 * The API layer between the app and any backend.
 *
 * The frontend is open source; the production backend (Supabase + the
 * Anthropic-keyed Edge Function) is closed. Everything the UI needs is
 * expressed through this single interface, so a contributor can run the whole
 * app locally against the in-browser `mock` backend with no server, and the
 * real `supabase` backend is just another implementation of the same contract.
 *
 * To add a third backend (your own server, a different DB, etc.), implement
 * `FitnessBackend` and wire it into `backend/index.ts` — nothing in
 * `components/` or `hooks/` should need to change.
 */
import type { DraftEntry, Entry, EntryKind, Goals } from "../types";

/** Minimal user shape the UI needs — deliberately not Supabase's `User`. */
export interface AppUser {
  id: string;
  email: string | null;
}

export interface AppSession {
  user: AppUser;
  /** Bearer token for backend calls. `"mock"` in demo mode. */
  accessToken: string;
}

export type BackendKind = "mock" | "supabase";

export interface ParseInput {
  kind: EntryKind;
  text?: string;
  image?: { media_type: string; data: string };
}

export interface FitnessBackend {
  /** Which implementation this is — drives demo-mode UI affordances. */
  readonly kind: BackendKind;
  /** Human-readable note about the backend state (demo banner / config warning). */
  readonly notice: string | null;

  // ── auth ────────────────────────────────────────────────────────────────
  getSession(): Promise<AppSession | null>;
  /** Subscribe to sign-in/out. Returns an unsubscribe function. */
  onAuthStateChange(cb: (session: AppSession | null) => void): () => void;
  signInWithPassword(email: string, password: string): Promise<void>;
  /** Returns an optional status message (e.g. "check your email"). */
  signInWithOtp(email: string): Promise<{ message?: string }>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;

  // ── AI logging ──────────────────────────────────────────────────────────
  /** Plain language / food photo → draft entries with estimated macros. */
  parseEntries(input: ParseInput): Promise<DraftEntry[]>;

  // ── data ────────────────────────────────────────────────────────────────
  addEntries(date: string, drafts: DraftEntry[]): Promise<Entry[]>;
  listEntries(date: string): Promise<Entry[]>;
  listEntriesInRange(from: string, to: string): Promise<Entry[]>;
  updateEntry(id: string, patch: Partial<Entry>): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  getGoals(): Promise<Goals>;
  saveGoals(goals: Goals): Promise<void>;
}
