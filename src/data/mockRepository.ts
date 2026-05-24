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

import type { DiaryEntry, Goals, Profile, WeightEntry } from "../types";
import { DEFAULT_GOALS } from "../types";
import { readJson, writeJson } from "../bridge/vfs";
import type { NewDiaryEntry, Repository } from "./repository";
import { newId } from "./id";

const STORE_PATH = "store.json";

interface StoreShape {
  v: 1;
  profile: Profile | null;
  goals: Goals | null;
  diary: DiaryEntry[];
  weights: WeightEntry[];
}

const EMPTY: StoreShape = { v: 1, profile: null, goals: null, diary: [], weights: [] };

export class MockRepository implements Repository {
  readonly kind = "mock" as const;
  private store: StoreShape = structuredClone(EMPTY);

  async init(): Promise<void> {
    const loaded = await readJson<StoreShape>(STORE_PATH, structuredClone(EMPTY));
    this.store = loaded && loaded.v === 1 ? loaded : structuredClone(EMPTY);
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
}
