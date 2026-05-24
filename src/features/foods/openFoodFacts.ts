/**
 * Open Food Facts provider — barcodes + branded/packaged items.
 *
 * Free, open, CORS-enabled, no key. Two entry points: barcode lookup (the
 * scanner's target) and text search. Both normalize OFF's loose, locale-mixed
 * nutriment fields into our per-serving `FoodItem`.
 *
 * Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
 */

import type { FoodItem, Macros } from "../../types";

const BASE = "https://world.openfoodfacts.org";
// Identify ourselves per OFF etiquette so we're not rate-limited as anon.
const UA = "ConjureOS-Nourish/0.1 (https://github.com/Jonny-B/conjureos-fitness)";

interface OffNutriments {
  ["energy-kcal_serving"]?: number;
  ["proteins_serving"]?: number;
  ["carbohydrates_serving"]?: number;
  ["fat_serving"]?: number;
  ["fiber_serving"]?: number;
  ["sugars_serving"]?: number;
  ["sodium_serving"]?: number;
  ["energy-kcal_100g"]?: number;
  ["proteins_100g"]?: number;
  ["carbohydrates_100g"]?: number;
  ["fat_100g"]?: number;
  ["fiber_100g"]?: number;
  ["sugars_100g"]?: number;
  ["sodium_100g"]?: number;
}

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: OffNutriments;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Map one OFF product to a FoodItem, preferring per-serving over per-100g. */
function toFoodItem(p: OffProduct): FoodItem | null {
  const name = (p.product_name ?? "").trim();
  if (!name) return null;
  const n = p.nutriments ?? {};
  const hasServing = n["energy-kcal_serving"] !== undefined;

  const perServing: Macros = hasServing
    ? {
        calories: Math.round(num(n["energy-kcal_serving"])),
        protein: Math.round(num(n["proteins_serving"])),
        carbs: Math.round(num(n["carbohydrates_serving"])),
        fat: Math.round(num(n["fat_serving"])),
      }
    : {
        calories: Math.round(num(n["energy-kcal_100g"])),
        protein: Math.round(num(n["proteins_100g"])),
        carbs: Math.round(num(n["carbohydrates_100g"])),
        fat: Math.round(num(n["fat_100g"])),
      };

  const servingGrams =
    typeof p.serving_quantity === "number"
      ? p.serving_quantity
      : typeof p.serving_quantity === "string"
        ? Number(p.serving_quantity) || undefined
        : undefined;

  const servingSize = hasServing
    ? (p.serving_size?.trim() || (servingGrams ? `${servingGrams} g` : "1 serving"))
    : "100 g";

  return {
    id: p.code ?? name,
    source: "openfoodfacts",
    name,
    brand: p.brands?.split(",")[0]?.trim() || undefined,
    barcode: p.code,
    perServing,
    micros: {
      fiber: hasServing ? round1(n["fiber_serving"]) : round1(n["fiber_100g"]),
      sugar: hasServing ? round1(n["sugars_serving"]) : round1(n["sugars_100g"]),
      // OFF reports sodium in grams; we store milligrams.
      sodium: hasServing ? mg(n["sodium_serving"]) : mg(n["sodium_100g"]),
    },
    servingSize,
    servingGrams: hasServing ? servingGrams : 100,
  };
}

const round1 = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined;
const mg = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) : undefined;

export async function lookupBarcode(
  barcode: string,
  signal?: AbortSignal,
): Promise<FoodItem | null> {
  const code = barcode.replace(/\D/g, "");
  if (!code) return null;
  const url = `${BASE}/api/v2/product/${encodeURIComponent(code)}.json`;
  let resp: Response;
  try {
    resp = await fetch(url, { signal, headers: { "User-Agent": UA } });
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  const json = (await resp.json()) as { status?: number; product?: OffProduct };
  if (json.status !== 1 || !json.product) return null;
  return toFoodItem({ ...json.product, code });
}

export async function searchText(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<FoodItem[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL(`${BASE}/cgi/search.pl`);
  url.searchParams.set("search_terms", q);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", String(Math.min(limit, 30)));
  url.searchParams.set(
    "fields",
    "code,product_name,brands,serving_size,serving_quantity,nutriments",
  );
  let resp: Response;
  try {
    resp = await fetch(url.toString(), { signal, headers: { "User-Agent": UA } });
  } catch {
    return [];
  }
  if (!resp.ok) return [];
  const json = (await resp.json()) as { products?: OffProduct[] };
  const out: FoodItem[] = [];
  for (const p of json.products ?? []) {
    const item = toFoodItem(p);
    // Drop entries with no usable energy — OFF has many incomplete records.
    if (item && item.perServing.calories > 0) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
