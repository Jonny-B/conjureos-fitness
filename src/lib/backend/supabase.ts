/**
 * Real backend — Supabase (shared with ConjureOS) for auth + data, and the
 * `fitness-parse` Edge Function for AI logging. Only instantiated when the
 * env vars are present (see `backend/index.ts`); reads/writes are RLS-scoped
 * to the signed-in user, and the Anthropic key stays server-side.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { DraftEntry, Entry, Goals } from "../types";
import { DEFAULT_GOALS } from "../types";
import type { AppSession, FitnessBackend, ParseInput } from "./types";

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = (): boolean => url.length > 0 && anonKey.length > 0;

const toAppSession = (s: Session | null): AppSession | null =>
  s ? { user: { id: s.user.id, email: s.user.email ?? null }, accessToken: s.access_token } : null;

export function createSupabaseBackend(): FitnessBackend {
  const client: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  async function userId(): Promise<string> {
    const { data } = await client.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new Error("Not signed in.");
    return id;
  }

  return {
    kind: "supabase",
    notice: null,

    async getSession() {
      const { data } = await client.auth.getSession();
      return toAppSession(data.session);
    },

    onAuthStateChange(cb) {
      const { data } = client.auth.onAuthStateChange((_e, session) => cb(toAppSession(session)));
      return () => data.subscription.unsubscribe();
    },

    async signInWithPassword(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },

    async signInWithOtp(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw new Error(error.message);
      return { message: "Check your email for a sign-in link." };
    },

    async signInWithGoogle() {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw new Error(error.message);
    },

    async signOut() {
      await client.auth.signOut();
    },

    async parseEntries(input: ParseInput) {
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const res = await fetch(`${url}/functions/v1/fitness-parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Logging failed (${res.status}).`);
      }
      const body = (await res.json()) as { entries: DraftEntry[] };
      return body.entries ?? [];
    },

    async addEntries(date, drafts) {
      const uid = await userId();
      const rows = drafts.map((d) => ({
        user_id: uid,
        entry_date: date,
        kind: d.kind,
        meal: d.kind === "food" ? d.meal ?? "snacks" : null,
        name: d.name,
        quantity: d.quantity || null,
        calories: d.calories,
        protein_g: d.kind === "food" ? d.protein_g : null,
        carbs_g: d.kind === "food" ? d.carbs_g : null,
        fat_g: d.kind === "food" ? d.fat_g : null,
      }));
      const { data, error } = await client.from("fitness_entries").insert(rows).select();
      if (error) throw new Error(error.message);
      return (data ?? []) as Entry[];
    },

    async listEntries(date) {
      const { data, error } = await client
        .from("fitness_entries")
        .select("*")
        .eq("entry_date", date)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Entry[];
    },

    async listEntriesInRange(from, to) {
      const { data, error } = await client
        .from("fitness_entries")
        .select("*")
        .gte("entry_date", from)
        .lte("entry_date", to);
      if (error) throw new Error(error.message);
      return (data ?? []) as Entry[];
    },

    async updateEntry(id, patch) {
      const { error } = await client.from("fitness_entries").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },

    async deleteEntry(id) {
      const { error } = await client.from("fitness_entries").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },

    async getGoals() {
      const { data, error } = await client
        .from("fitness_goals")
        .select("calories, protein_g, carbs_g, fat_g")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? (data as Goals) : { ...DEFAULT_GOALS };
    },

    async saveGoals(goals) {
      const uid = await userId();
      const { error } = await client
        .from("fitness_goals")
        .upsert({ user_id: uid, ...goals, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
  };
}
