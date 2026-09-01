/**
 * Supabase-backed repository — the real data layer against the shared project's
 * `fitness` schema. Selected only when the project is configured AND the host
 * supplies an SSO session token (see repository.ts).
 *
 * Row ownership is enforced server-side: every table defaults `user_id` to
 * `auth.uid()` and RLS scopes reads/writes to the caller, so this client never
 * sends or trusts a user id — it just sends the session token.
 *
 * The schema + RLS live in the private backend repo (staged under `_backend/`
 * in this checkout). Table/column names here must match those migrations.
 */

import type {
  DailyCheckoff,
  DiaryEntry,
  Goals,
  Plan,
  Profile,
  SleepEntry,
  SymptomEntry,
  WaterEntry,
  WeightEntry,
  WorkoutSession,
} from "../types";
import { DEFAULT_GOALS } from "../types";
import { getAccessToken } from "../bridge/host";
import type { DayLogPatch, NewDiaryEntry, Repository } from "./repository";
import { PLAN_REQUIRES_V2_BACKEND } from "./repository";
import { SupabaseRestClient } from "./supabaseClient";

interface ProfileRow {
  sex: Profile["sex"];
  age: number;
  height_cm: number;
  weight_kg: number;
  activity_level: Profile["activityLevel"];
  direction: Profile["direction"];
  goal_weight_kg: number | null;
  units: Profile["units"];
}
interface GoalsRow {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}
interface DiaryRow {
  id: string;
  date: string;
  meal: DiaryEntry["meal"];
  food: DiaryEntry["food"];
  quantity: number;
  logged_at: string;
}
interface WeightRow {
  date: string;
  weight_kg: number;
}

/**
 * Postgres-backed {@link Repository}, selected when VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY are set. Rows are scoped to the signed-in user by
 * RLS; `init()` performs an anonymous sign-in when no session exists.
 *
 * Covers the v1 surface (profile, goals, diary, weights) only — every v2 plan
 * and session method throws {@link PLAN_REQUIRES_V2_BACKEND}, which callers
 * catch to fall back to the mock layer (DECISIONS 2026-06-24).
 */
export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;
  private client: SupabaseRestClient;

  constructor() {
    this.client = new SupabaseRestClient(
      import.meta.env.VITE_SUPABASE_URL!,
      import.meta.env.VITE_SUPABASE_ANON_KEY!,
      getAccessToken,
    );
  }

  async init(): Promise<void> {
    // Token is fetched per-request; nothing to warm. Presence was already
    // verified by the selector before we got constructed.
  }

  async getProfile(): Promise<Profile | null> {
    const rows = await this.client.select<ProfileRow>("profiles", "select=*&limit=1");
    const r = rows[0];
    if (!r) return null;
    return {
      sex: r.sex,
      age: r.age,
      heightCm: r.height_cm,
      weightKg: r.weight_kg,
      activityLevel: r.activity_level,
      direction: r.direction,
      goalWeightKg: r.goal_weight_kg ?? undefined,
      units: r.units,
    };
  }

  async saveProfile(p: Profile): Promise<void> {
    await this.client.upsert(
      "profiles",
      {
        sex: p.sex,
        age: p.age,
        height_cm: p.heightCm,
        weight_kg: p.weightKg,
        activity_level: p.activityLevel,
        direction: p.direction,
        goal_weight_kg: p.goalWeightKg ?? null,
        units: p.units,
      },
      "user_id",
    );
  }

  async getGoals(): Promise<Goals> {
    const rows = await this.client.select<GoalsRow>("goals", "select=*&limit=1");
    const r = rows[0];
    return r ? { calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat } : { ...DEFAULT_GOALS };
  }

  async saveGoals(g: Goals): Promise<void> {
    await this.client.upsert("goals", { ...g }, "user_id");
  }

  async listDiary(date: string): Promise<DiaryEntry[]> {
    const rows = await this.client.select<DiaryRow>(
      "diary_entries",
      `select=*&date=eq.${encodeURIComponent(date)}&order=logged_at.asc`,
    );
    return rows.map(rowToEntry);
  }

  async addDiaryEntry(entry: NewDiaryEntry): Promise<DiaryEntry> {
    const rows = await this.client.insert<DiaryRow>("diary_entries", {
      date: entry.date,
      meal: entry.meal,
      food: entry.food,
      quantity: entry.quantity,
    });
    const r = rows[0];
    if (!r) throw new Error("insert returned no row");
    return rowToEntry(r);
  }

  async updateDiaryEntry(
    id: string,
    patch: Partial<Pick<DiaryEntry, "quantity" | "meal" | "food">>,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (patch.quantity !== undefined) body.quantity = patch.quantity;
    if (patch.meal !== undefined) body.meal = patch.meal;
    if (patch.food !== undefined) body.food = patch.food;
    if (Object.keys(body).length === 0) return;
    await this.client.patch("diary_entries", `id=eq.${encodeURIComponent(id)}`, body);
  }

  async removeDiaryEntry(id: string): Promise<void> {
    await this.client.remove("diary_entries", `id=eq.${encodeURIComponent(id)}`);
  }

  async listWeights(): Promise<WeightEntry[]> {
    const rows = await this.client.select<WeightRow>("weights", "select=*&order=date.desc");
    return rows.map((r) => ({ date: r.date, weightKg: r.weight_kg }));
  }

  async upsertWeight(entry: WeightEntry): Promise<void> {
    await this.client.upsert("weights", { date: entry.date, weight_kg: entry.weightKg }, "user_id,date");
  }

  async removeWeight(date: string): Promise<void> {
    await this.client.remove("weights", `date=eq.${date}`);
  }

  // RLS scopes deletes to the caller's rows; the always-true filter satisfies
  // PostgREST's require-a-filter rule for bulk deletes.
  async clearDiary(): Promise<void> {
    await this.client.remove("diary_entries", "id=not.is.null");
  }

  async clearWeights(): Promise<void> {
    await this.client.remove("weights", "date=not.is.null");
  }

  async clearWorkoutHistory(): Promise<void> {
    // Workout sessions/day logs are VFS-only (v2) — nothing server-side yet.
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }

  // ── Sleep, water & symptoms: VFS-only, same as the v2 plan surface ──
  // No server tables yet, so every method throws and callers fall back to the
  // mock layer exactly as they already do for plans.

  async clearWellbeing(): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async listSleep(): Promise<SleepEntry[]> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async listSleepRange(): Promise<SleepEntry[]> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async saveSleep(): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async removeSleep(): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async listWater(): Promise<WaterEntry[]> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async listWaterRange(): Promise<WaterEntry[]> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async addWater(): Promise<WaterEntry> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async updateWater(): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async removeWater(): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async listSymptoms(): Promise<SymptomEntry[]> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async listSymptomsRange(): Promise<SymptomEntry[]> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async addSymptom(): Promise<SymptomEntry> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async updateSymptom(): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async removeSymptom(): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }

  // ── v2: VFS-only today; no backend rows yet (DECISIONS 2026-06-24). ──
  // Every method throws so callers can detect the unsupported backend and
  // route plan data through the mock layer instead.

  async getPlan(): Promise<Plan | null> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async savePlan(_plan: Plan): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async clearPlan(): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async getDayLog(_date: string): Promise<DailyCheckoff | null> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async saveDayLog(_date: string, _patch: DayLogPatch): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async markCheckoff(_goalId: string, _date: string, _done: boolean): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async listWorkoutSessions(_limit?: number): Promise<WorkoutSession[]> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async saveWorkoutSession(_session: WorkoutSession): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
  async removeWorkoutSession(_id: string): Promise<void> {
    throw new Error(PLAN_REQUIRES_V2_BACKEND);
  }
}

function rowToEntry(r: DiaryRow): DiaryEntry {
  return {
    id: r.id,
    date: r.date,
    meal: r.meal,
    food: r.food,
    quantity: Number(r.quantity),
    loggedAt: r.logged_at,
  };
}
