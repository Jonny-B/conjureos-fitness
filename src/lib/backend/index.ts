/**
 * Backend selector. Picks the implementation once, at module load:
 *
 *   - VITE_USE_MOCK=true            → mock (force demo mode)
 *   - Supabase env vars present     → supabase (real backend)
 *   - otherwise                     → mock (so the open frontend runs with
 *                                      zero setup: `npm install && npm run dev`)
 *
 * Everything else in the app imports `backend` from here (usually via the
 * `lib/api` facade) and never knows or cares which one it got.
 */
import type { FitnessBackend } from "./types";
import { createSupabaseBackend, supabaseConfigured } from "./supabase";
import { createMockBackend } from "./mock";

const forceMock = import.meta.env.VITE_USE_MOCK === "true";
const useMock = forceMock || !supabaseConfigured();

export const backend: FitnessBackend = useMock ? createMockBackend() : createSupabaseBackend();
export const backendKind = backend.kind;
export const isDemo = backend.kind === "mock";

if (useMock && !forceMock) {
  // eslint-disable-next-line no-console
  console.info(
    "[ConjureOS Fitness] No Supabase env vars found — running the in-browser mock backend (demo mode).",
  );
}
