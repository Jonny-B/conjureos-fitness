/**
 * The app's data-access facade. Thin pass-through to the active backend
 * (mock or supabase) so components import stable named functions and stay
 * decoupled from which backend is wired in. See `lib/backend/` for the
 * implementations and `lib/backend/types.ts` for the contract.
 */
import { backend } from "./backend";
import type { DraftEntry, Entry, Goals } from "./types";
import type { ParseInput } from "./backend/types";

export { ymd } from "./date";
export { backend, backendKind, isDemo } from "./backend";

export const parseEntries = (input: ParseInput): Promise<DraftEntry[]> => backend.parseEntries(input);
export const addEntries = (date: string, drafts: DraftEntry[]): Promise<Entry[]> => backend.addEntries(date, drafts);
export const listEntries = (date: string): Promise<Entry[]> => backend.listEntries(date);
export const listEntriesInRange = (from: string, to: string): Promise<Entry[]> => backend.listEntriesInRange(from, to);
export const updateEntry = (id: string, patch: Partial<Entry>): Promise<void> => backend.updateEntry(id, patch);
export const deleteEntry = (id: string): Promise<void> => backend.deleteEntry(id);
export const getGoals = (): Promise<Goals> => backend.getGoals();
export const saveGoals = (goals: Goals): Promise<void> => backend.saveGoals(goals);
