/**
 * Data layer. Reads/writes go straight to Supabase (RLS scopes everything to
 * the signed-in user); AI parsing goes through the fitness-parse Edge Function
 * so the Anthropic key stays server-side.
 */
import {
  supabase,
  isSupabaseConfigured,
  functionsUrl,
  anonKeyValue,
} from "./supabase";
import type { DraftEntry, Entry, EntryKind, Goals } from "./types";
import { DEFAULT_GOALS } from "./types";

const requireClient = () => {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
};

export { isSupabaseConfigured };

/** Local YYYY-MM-DD for a date (entries are bucketed by the user's own day). */
export const ymd = (d = new Date()): string => {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return tz.toISOString().slice(0, 10);
};

async function authHeader(): Promise<string> {
  const client = requireClient();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return token;
}

/** Parse a plain-language description (or food photo) into draft entries. */
export async function parseEntries(input: {
  kind: EntryKind;
  text?: string;
  image?: { media_type: string; data: string };
}): Promise<DraftEntry[]> {
  const token = await authHeader();
  const res = await fetch(`${functionsUrl()}/fitness-parse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKeyValue(),
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
}

/** Insert draft entries for a given day, returning the saved rows. */
export async function addEntries(date: string, drafts: DraftEntry[]): Promise<Entry[]> {
  const client = requireClient();
  const { data: userData } = await client.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in.");

  const rows = drafts.map((d) => ({
    user_id: userId,
    entry_date: date,
    kind: d.kind,
    name: d.name,
    quantity: d.quantity || null,
    calories: d.calories,
    protein_g: d.kind === "food" ? d.protein_g : null,
    carbs_g: d.kind === "food" ? d.carbs_g : null,
    fat_g: d.kind === "food" ? d.fat_g : null,
  }));

  const { data, error } = await client
    .from("fitness_entries")
    .insert(rows)
    .select();
  if (error) throw new Error(error.message);
  return (data ?? []) as Entry[];
}

export async function listEntries(date: string): Promise<Entry[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("fitness_entries")
    .select("*")
    .eq("entry_date", date)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Entry[];
}

/** Entries across an inclusive date range, for the weekly history. */
export async function listEntriesInRange(from: string, to: string): Promise<Entry[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("fitness_entries")
    .select("*")
    .gte("entry_date", from)
    .lte("entry_date", to);
  if (error) throw new Error(error.message);
  return (data ?? []) as Entry[];
}

export async function updateEntry(id: string, patch: Partial<Entry>): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("fitness_entries").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteEntry(id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("fitness_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getGoals(): Promise<Goals> {
  const client = requireClient();
  const { data, error } = await client
    .from("fitness_goals")
    .select("calories, protein_g, carbs_g, fat_g")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data as Goals) : { ...DEFAULT_GOALS };
}

export async function saveGoals(goals: Goals): Promise<void> {
  const client = requireClient();
  const { data: userData } = await client.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in.");
  const { error } = await client
    .from("fitness_goals")
    .upsert({ user_id: userId, ...goals, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
