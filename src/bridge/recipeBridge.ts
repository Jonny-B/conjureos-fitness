/**
 * Client for the Recipes anchor app's cross-app actions (Phase 13a), wrapped
 * in a typed surface with a dev-mode mock. Lets Conjure Fitness read the user's saved
 * recipes and log a cooked one as a meal.
 *
 * The Recipes app registers `listRecipes`, `getRecipe`, `addRecipe`,
 * `markCooked`. We only need the read + markCooked paths here. Reads are
 * side-effect-free (`actions.read`, no grant prompt); `markCooked` is
 * `actions.write` and triggers ConjureOS's one-time per-caller grant dialog.
 *
 * The installed app path can differ from the default slug, so we discover it
 * via `actions.list()` rather than hard-coding `/apps/recipes`.
 */

declare global {
  interface ConjureosBridge {
    actions?: {
      register?: (
        handlers: Record<string, (params?: unknown) => Promise<unknown>>,
      ) => Promise<void>;
      invoke?: (
        appPath: string,
        actionName: string,
        params?: unknown,
        opts?: { timeoutMs?: number },
      ) => Promise<unknown>;
      list?: () => Promise<
        Array<{
          appPath: string;
          displayName: string;
          actions: Array<{ name: string; permission: string; description?: string }>;
        }>
      >;
    };
  }
}

/** Nutrition strip as the Recipes app emits it (per serving, estimated). */
export interface RecipeNutrition {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface ListedRecipe {
  slug: string;
  title: string;
  servings: number;
  ingredients: string[];
  savedAt: string;
  madeCount: number;
  nutrition: RecipeNutrition | null;
}

const DEFAULT_PATH = "/apps/recipes";
let cachedPath: string | null = null;

function actions() {
  return window.__conjureos?.actions;
}

export function isRecipeBridgeAvailable(): boolean {
  return typeof actions()?.invoke === "function";
}

/** Resolve the installed Recipes app path by scanning for `getRecipe`. */
async function resolveRecipeAppPath(): Promise<string | null> {
  if (cachedPath) return cachedPath;
  const a = actions();
  if (!a?.invoke) return null;
  if (a.list) {
    try {
      const apps = await a.list();
      const match = apps.find((app) => app.actions.some((x) => x.name === "getRecipe"));
      if (match) {
        cachedPath = match.appPath;
        return cachedPath;
      }
    } catch {
      /* fall through to default */
    }
  }
  cachedPath = DEFAULT_PATH;
  return cachedPath;
}

export async function listRecipes(filter?: string): Promise<ListedRecipe[]> {
  const a = actions();
  const path = await resolveRecipeAppPath();
  if (!a?.invoke || !path) return mockRecipes(filter);
  try {
    const res = (await a.invoke(path, "listRecipes", { filter, limit: 100 })) as {
      recipes?: ListedRecipe[];
    };
    return res?.recipes ?? [];
  } catch {
    return [];
  }
}

export async function getRecipe(slug: string): Promise<ListedRecipe | null> {
  const a = actions();
  const path = await resolveRecipeAppPath();
  if (!a?.invoke || !path) return mockRecipes().find((r) => r.slug === slug) ?? null;
  try {
    const res = (await a.invoke(path, "getRecipe", { slug })) as { recipe?: ListedRecipe | null };
    return res?.recipe ?? null;
  } catch {
    return null;
  }
}

/** Mark a recipe cooked. Best-effort: a denied grant shouldn't break logging. */
export async function markCooked(slug: string): Promise<void> {
  const a = actions();
  const path = await resolveRecipeAppPath();
  if (!a?.invoke || !path) return;
  try {
    await a.invoke(path, "markCooked", { slug });
  } catch {
    /* grant denied or app closed — non-fatal */
  }
}

function mockRecipes(filter?: string): ListedRecipe[] {
  const all: ListedRecipe[] = [
    {
      slug: "spinach-feta-scramble",
      title: "Spinach & Feta Scramble",
      servings: 2,
      ingredients: ["3 eggs", "1 cup spinach", "30g feta", "1 tsp olive oil"],
      savedAt: "2026-05-20T08:00:00.000Z",
      madeCount: 3,
      nutrition: { calories: 320, protein: 22, fat: 24, carbs: 4 },
    },
    {
      slug: "roasted-pepper-frittata",
      title: "Roasted Pepper Frittata",
      servings: 4,
      ingredients: ["6 eggs", "1 red bell pepper", "50g feta", "1/4 cup milk"],
      savedAt: "2026-05-18T18:30:00.000Z",
      madeCount: 1,
      nutrition: { calories: 245, protein: 17, fat: 18, carbs: 5 },
    },
  ];
  if (!filter) return all;
  const f = filter.toLowerCase();
  return all.filter(
    (r) => r.title.toLowerCase().includes(f) || r.ingredients.some((i) => i.toLowerCase().includes(f)),
  );
}
