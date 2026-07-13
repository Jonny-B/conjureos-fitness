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

/**
 * Weighted merge that front-loads `primary`, taking `pw` from it for every `sw`
 * from `secondary`. Used to bias results toward USDA (a US database) over Open
 * Food Facts' noisy global catalog, while still surfacing OFF's branded items.
 * Leftovers from either list are appended once the other runs dry.
 */
function mergeUsFirst<T>(primary: T[], secondary: T[], pw = 2, sw = 1): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < primary.length || j < secondary.length) {
    for (let p = 0; p < pw && i < primary.length; p++) out.push(primary[i++]!);
    for (let s = 0; s < sw && j < secondary.length; s++) out.push(secondary[j++]!);
  }
  return out;
}

/**
 * Text search across Open Food Facts (branded) + USDA (whole foods), run in
 * parallel and merged USDA-first to bias toward US results (see mergeUsFirst).
 *
 * `onPartial`, when given, fires with the merged list as each provider lands so
 * the UI can paint the fast provider's hits (USDA is usually sub-second) without
 * waiting on the slow one (OFF's search endpoint often takes seconds). Both
 * requests are individually timed out, so a dead provider can't stall the other.
 */
export async function searchFoods(
  query: string,
  limit = 20,
  signal?: AbortSignal,
  onPartial?: (foods: FoodItem[]) => void,
): Promise<FoodItem[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  // US bias: pull more from USDA (a US database) than OFF, and front-load it in
  // the merge. OFF still contributes branded items USDA lacks.
  const usdaWant = Math.ceil(limit * 0.7);
  const offWant = Math.ceil(limit * 0.5);

  let offResults: FoodItem[] = [];
  let usdaResults: FoodItem[] = [];
  const merged = () => mergeUsFirst(usdaResults, offResults, 2, 1).slice(0, limit);

  const offP = off
    .searchText(q, offWant, signal)
    .then((r) => {
      offResults = r;
      if (!signal?.aborted) onPartial?.(merged());
    })
    .catch(() => {});
  const usdaP = usda
    .searchText(q, usdaWant, signal)
    .then((r) => {
      usdaResults = r;
      if (!signal?.aborted) onPartial?.(merged());
    })
    .catch(() => {});

  await Promise.all([offP, usdaP]);
  return merged();
}

export { USING_DEMO_KEY } from "./usda";
