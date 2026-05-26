/**
 * Supabase client singleton — shares ConjureOS's project, so the same account
 * signs in here. `null` when env vars are missing, so the app still builds and
 * runs (sign-in just shows a "not configured" notice) before the project is
 * wired up. Guard with `isSupabaseConfigured()` before use.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

const configured = url.length > 0 && anonKey.length > 0;

export const supabase: SupabaseClient | null = configured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const isSupabaseConfigured = (): boolean => configured;

/** Base URL for invoking Edge Functions on the same project. */
export const functionsUrl = (): string => `${url.replace(/\/$/, "")}/functions/v1`;

export const anonKeyValue = (): string => anonKey;
