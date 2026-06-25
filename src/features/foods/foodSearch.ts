/**
 * Unified food lookup across providers.
 *
 *   - Text search fans out to Open Food Facts (branded) AND USDA (whole foods)
 *     in parallel, interleaving results so the list isn't dominated by one
 *     source. Either provider failing is non-fatal: we return what we got.
 *   - Barcode lookup tries Conjure Health DB FIRST (server-side, which itself
 *     falls through to OFF + backfills our DB on hit), then OFF directly as a
 *     fallback for the DEMO / offline / unconfigured cases. Caches positive
 *     hits to the app's VFS so the same pantry items don't re-roundtrip.
 */

import type { FoodItem } from "../../types";
import { readJson, writeJson } from "../../bridge/vfs";
import * as off from "./openFoodFacts";
import * as usda from "./usda";
import * as conjure from "./conjureHealthDb";

const CACHE_PATH = "food-cache.json";
const CACHE_VERSION = 2 as const;

interface BarcodeCache {
  v: typeof CACHE_VERSION;
  // barcode -> FoodItem, or null when a prior lookup found nothing.
  entries: Record<string, FoodItem | null>;
}

let cache: BarcodeCache | null = null;

async function loadCache(): Promise<BarcodeCache> {
  if (cache) return cache;
  const loaded = await readJson<BarcodeCache>(CACHE_PATH, { v: CACHE_VERSION, entries: {} });
  if (loaded.v !== CACHE_VERSION || typeof loaded.entries !== "object") {
    cache = { v: CACHE_VERSION, entries: {} };
  } else {
    cache = loaded;
  }
  return cache;
}

export async function lookupBarcode(
  barcode: string,
  signal?: AbortSignal,
): Promise<FoodItem | null> {
  const code = barcode.replace(/\D/g, "");
  if (!code) return null;

  const c = await loadCache();
  if (Object.prototype.hasOwnProperty.call(c.entries, code)) {
    return c.entries[code] ?? null;
  }

  const t0 = performance.now();

  // Step 1: Conjure Health DB (the Edge Function itself checks OFF + backfills on hit).
  const ours = await conjure.lookupBarcode(code, signal);
  if (ours) {
    void conjure.logScanAttempt({
      barcode: code,
      resolvedFrom: "our_db",
      durationMs: performance.now() - t0,
    });
    c.entries[code] = ours;
    await writeJson(CACHE_PATH, c);
    return ours;
  }

  // Step 2: OFF direct fallback. Only useful when the Edge Function is unreachable
  // (DEMO mode, network outage); the server side already tried OFF in step 1 when live.
  const offItem = await off.lookupBarcode(code, signal);
  if (offItem) {
    void conjure.logScanAttempt({
      barcode: code,
      resolvedFrom: "off",
      durationMs: performance.now() - t0,
    });
    c.entries[code] = offItem;
    await writeJson(CACHE_PATH, c);
    return offItem;
  }

  void conjure.logScanAttempt({
    barcode: code,
    resolvedFrom: "miss",
    durationMs: performance.now() - t0,
  });
  c.entries[code] = null;
  await writeJson(CACHE_PATH, c);
  return null;
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
