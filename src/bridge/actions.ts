/**
 * Cross-app actions Conjure Fitness exposes via ConjureOS's Phase 13a bridge, so the
 * home orchestrator, an assistant, or the Recipes app can write to / read from
 * the diary:
 *
 *   logFood({ name, calories, protein?, carbs?, fat?, meal?, date? })  → write
 *   todayTotals()                                                      → read
 *   logRecipeMeal({ slug, servings?, meal?, date? })                   → write
 *
 * Params come from other (untrusted) apps, so every field is type-checked,
 * length-capped, and range-clamped before it reaches the repository. Reads are
 * side-effect-free; writes trigger ConjureOS's one-time per-caller grant.
 */

import type { Macros, MealType } from "../types";
import { MEAL_TYPES } from "../types";
import { getRepository } from "../data/repository";
import { parseMeal } from "../features/naturalLanguage";
import { buildDayView, todayISO } from "../features/diary";
import { getRecipe, markCooked, RecipesAppClosedError, type ListedRecipe } from "./recipeBridge";
import { newId } from "../data/id";

function asObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("params must be an object");
  return v as Record<string, unknown>;
}
function asString(v: unknown, field: string, max: number): string {
  if (typeof v !== "string") throw new Error(`params.${field} must be a string`);
  const t = v.trim();
  if (!t) throw new Error(`params.${field} cannot be empty`);
  if (t.length > max) throw new Error(`params.${field} exceeds ${max} chars`);
  // eslint-disable-next-line no-control-regex
  return t.replace(/[\x00-\x1F\x7F]/g, "");
}
function asNonNegInt(v: unknown, field: string, max: number, dflt = 0): number {
  if (v === undefined || v === null) return dflt;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`params.${field} must be a non-negative number`);
  return Math.min(max, Math.round(n));
}
function asMeal(v: unknown): MealType {
  if (typeof v === "string" && (MEAL_TYPES as string[]).includes(v)) return v as MealType;
  // Default by time of day if unspecified.
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snacks";
}
function asDate(v: unknown): string {
  if (v === undefined || v === null) return todayISO();
  const s = asString(v, "date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("params.date must be YYYY-MM-DD");
  return s;
}

async function logFood(raw?: unknown): Promise<{ id: string }> {
  const p = asObject(raw);
  const name = asString(p.name, "name", 80);
  const meal = asMeal(p.meal);
  const date = asDate(p.date);

  // Calories are optional. When a caller names a food without numbers ("a
  // McCrispy sandwich"), estimate the macros from the name — the same estimator
  // the Describe tab uses — instead of requiring the caller to know them. An
  // explicit 0 (e.g. black coffee) is respected; only an absent value estimates.
  let perServing: Macros;
  let servingSize = "1 serving";
  let estimated = false;
  if (p.calories === undefined || p.calories === null) {
    const estimate = await estimateMacros(name);
    perServing = estimate.perServing;
    servingSize = estimate.servingSize;
    estimated = true;
  } else {
    perServing = {
      calories: asNonNegInt(p.calories, "calories", 5000),
      protein: asNonNegInt(p.protein, "protein", 500),
      carbs: asNonNegInt(p.carbs, "carbs", 800),
      fat: asNonNegInt(p.fat, "fat", 500),
    };
  }

  const repo = await getRepository();
  const entry = await repo.addDiaryEntry({
    date,
    meal,
    quantity: 1,
    food: {
      id: newId(),
      source: "custom",
      name,
      perServing,
      servingSize,
      // Mark AI-estimated logs so the diary flags them as an inaccurate guess.
      ...(estimated ? { provenance: { sourceTag: "ai_estimate" } } : {}),
    },
  });
  return { id: entry.id };
}

/**
 * Estimate one food's per-serving macros from its name via the shared
 * natural-language estimator. Falls back to all-zeros if the estimator returns
 * nothing (offline / unparseable) so a log never hard-fails on a missing number.
 */
async function estimateMacros(
  name: string,
): Promise<{ perServing: Macros; servingSize: string }> {
  try {
    const [item] = await parseMeal({ text: name });
    if (item) return { perServing: item.perServing, servingSize: item.servingSize };
  } catch {
    // Non-fatal — fall through to the zero estimate below.
  }
  return { perServing: { calories: 0, protein: 0, carbs: 0, fat: 0 }, servingSize: "1 serving" };
}

async function todayTotals(): Promise<{
  date: string;
  total: { calories: number; protein: number; carbs: number; fat: number };
  goals: { calories: number; protein: number; carbs: number; fat: number };
  caloriesRemaining: number;
}> {
  const repo = await getRepository();
  const date = todayISO();
  const [entries, goals] = await Promise.all([repo.listDiary(date), repo.getGoals()]);
  const { total } = buildDayView(date, entries);
  return { date, total, goals, caloriesRemaining: goals.calories - total.calories };
}

async function logRecipeMeal(raw?: unknown): Promise<{ id: string; logged: boolean }> {
  const p = asObject(raw);
  const slug = asString(p.slug, "slug", 80)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  if (!slug) throw new Error("params.slug invalid");
  const servings = Math.max(0.1, Math.min(20, Number(p.servings) || 1));
  const meal = asMeal(p.meal);
  const date = asDate(p.date);

  let recipe: ListedRecipe | null;
  try {
    recipe = await getRecipe(slug);
  } catch (err) {
    // Recipes app is closed: ask the orchestrator to open it and retry the
    // whole action, instead of failing as if the recipe didn't exist. The
    // shell catches this marker, opens Recipes, and re-invokes logRecipeMeal.
    if (err instanceof RecipesAppClosedError) {
      throw new Error(`NEEDS_APP_OPEN:${err.appPath}`);
    }
    throw err;
  }
  if (!recipe || !recipe.nutrition) {
    throw new Error(`recipe not found or has no nutrition: ${slug}`);
  }
  const n = recipe.nutrition;
  const repo = await getRepository();
  const entry = await repo.addDiaryEntry({
    date,
    meal,
    quantity: servings,
    food: {
      id: slug,
      source: "recipe",
      name: recipe.title,
      perServing: { calories: n.calories, protein: n.protein, carbs: n.carbs, fat: n.fat },
      servingSize: "1 serving",
    },
  });
  // Best-effort: confirm the recipe was cooked (non-fatal if the grant is denied).
  await markCooked(slug);
  return { id: entry.id, logged: true };
}

export async function registerActions(): Promise<void> {
  const bridge = window.__conjureos?.actions;
  if (!bridge?.register) return; // not inside ConjureOS, or host too old
  await bridge.register({ logFood, todayTotals, logRecipeMeal });
}
