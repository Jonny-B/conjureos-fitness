/**
 * Unified food lookup across providers.
 *
 *   - Text search fans out to Open Food Facts (branded) AND USDA (whole foods)
 *     in parallel, interleaving results so the list isn't dominated by one
 *     source. Either provider failing is non-fatal — we return what we got.
 *   - Barcode lookup hits Open Food Facts only (USDA isn't barcode-indexed)
 *     and is cached to the app's VFS, since barcodes are deterministic and the
 *     same pantry items get scanned over and over.
 */

import type { FoodItem } from "../../types";
import { readJson, writeJson } from "../../bridge/vfs";
import * as off from "./openFoodFacts";
import * as usda from "./usda";

const CACHE_PATH = "food-cache.json";

interface BarcodeCache {
  v: 1;
  // barcode → FoodItem, or null when a prior lookup found nothing.
  entries: Record<string, FoodItem | null>;
}

let cache: BarcodeCache | null = null;

async function loadCache(): Promise<BarcodeCache> {
  if (cache) return cache;
  cache = await readJson<BarcodeCache>(CACHE_PATH, { v: 1, entries: {} });
  if (cache.v !== 1 || typeof cache.entries !== "object") cache = { v: 1, entries: {} };
  return cache;
}

export async function lookupBarcode(
  barcode: string,
  signal?: AbortSignal,
): Promise<FoodItem | null> {
  const code = barcode.replace(/\D/g, "");
  if (!code) return null;
  const c = await loadCache();
  if (Object.prototype.hasOwnProperty.call(c.entries, code)) return c.entries[code] ?? null;

  const item = await off.lookupBarcode(code, signal);
  c.entries[code] = item;
  await writeJson(CACHE_PATH, c);
  return item;
}

/** Interleave two ordered lists so neither source buries the other. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

export async function searchFoods(
  query: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<FoodItem[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const half = Math.ceil(limit / 2);
  const [offResults, usdaResults] = await Promise.all([
    off.searchText(q, half, signal).catch(() => [] as FoodItem[]),
    usda.searchText(q, half, signal).catch(() => [] as FoodItem[]),
  ]);
  return interleave(offResults, usdaResults).slice(0, limit);
}

export { USING_DEMO_KEY } from "./usda";
