/**
 * Numeric coercion + range clamping.
 *
 * Two jobs live here, and the distinction matters at every call site:
 *
 *   - `clamp` narrows a number you already trust (a slider position, a computed
 *     target) into a legal range.
 *   - `toNumInRange` / `toIntInRange` coerce something UNTRUSTED — a JSON field
 *     from a model reply or a third-party food API — and return `null` when it
 *     isn't a finite number, so a garbage field fails loudly instead of
 *     silently becoming 0.
 *
 * Reach for the coercing pair whenever the input crossed a network or model
 * boundary; use `?? fallback` at the call site to pick the substitute value.
 */

/** Constrain an already-finite number to `[min, max]`. */
export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/**
 * Coerce an untrusted value to a number inside `[min, max]`.
 * Returns null for anything non-numeric (strings that don't parse, null,
 * objects, NaN, Infinity) rather than substituting a default — the caller
 * decides what a missing value means.
 */
export function toNumInRange(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return clamp(n, min, max);
}

/**
 * Like {@link toNumInRange}, but rounds to a whole number. For fields that are
 * counts by nature — reps, seconds, kcal, grams.
 */
export function toIntInRange(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  // Round BEFORE clamping so a fractional bound still yields an in-range int.
  return clamp(Math.round(n), min, max);
}
