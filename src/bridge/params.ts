/**
 * Validators for cross-app action params. Params come from other, untrusted
 * apps, so every field is type-checked, length-capped and range-checked before
 * it reaches the repository. Shared by the food actions (actions.ts) and the
 * fitness actions (fitnessActions.ts).
 */

import { todayISO } from "../features/diary";

export function asObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("params must be an object");
  return v as Record<string, unknown>;
}
export function asString(v: unknown, field: string, max: number): string {
  if (typeof v !== "string") throw new Error(`params.${field} must be a string`);
  const t = v.trim();
  if (!t) throw new Error(`params.${field} cannot be empty`);
  if (t.length > max) throw new Error(`params.${field} exceeds ${max} chars`);
  // eslint-disable-next-line no-control-regex
  return t.replace(/[\x00-\x1F\x7F]/g, "");
}
export function asNonNegInt(v: unknown, field: string, max: number, dflt = 0): number {
  if (v === undefined || v === null) return dflt;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`params.${field} must be a non-negative number`);
  return Math.min(max, Math.round(n));
}
/**
 * A caller-stated amount, validated against a schema's [min, max].
 *
 * Zero or negative is always REJECTED, never clamped up: for a field that
 * counts or measures something (days of history, servings, a corrected
 * quantity), "none" is a different request than "a little" — the caller
 * should just not make the call, or use deleteEntry — so it must never be
 * silently reinterpreted as a default or a minimum. A positive value that
 * falls outside the bound, on the other hand, is safe to clamp to the nearer
 * edge: capping an excessive "days: 999" or rounding "servings: 0.02" up to
 * the smallest representable amount doesn't invent an amount the caller never
 * stated, it just refuses to honor an amount stated too precisely or too
 * generously. Applied consistently at every "explicit but out of range"
 * numeric field on this surface — see recentNutrition/recentWellbeing (days),
 * logRecipeMeal (servings), and setFoodQuantity (quantity).
 */
export function asPositiveAmount(
  v: unknown,
  field: string,
  min: number,
  max: number,
  integer = false,
): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`params.${field} must be a positive number`);
  const clamped = Math.min(max, Math.max(min, n));
  return integer ? Math.round(clamped) : clamped;
}

/** A caller's YYYY-MM-DD, today when absent. `field` names it in errors. */
export function asDate(v: unknown, field = "date"): string {
  if (v === undefined || v === null) return todayISO();
  const s = asString(v, field, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`params.${field} must be YYYY-MM-DD`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // The regex only checks SHAPE. `new Date("2026-02-30")` rolls over to March
  // 2nd instead of failing, so the only reliable check is to construct the
  // date from its parts and read it back: a date that doesn't exist comes
  // back on a different day/month than the one asked for. This matters
  // because a written entry under a date the app's own UI can never navigate
  // to (recentNutrition/recentWellbeing walk real calendar days) is written
  // and then permanently invisible.
  const roundTrip = new Date(y, mo - 1, d);
  if (roundTrip.getFullYear() !== y || roundTrip.getMonth() !== mo - 1 || roundTrip.getDate() !== d) {
    throw new Error(`params.${field} must be a real calendar date (YYYY-MM-DD)`);
  }
  return s;
}

/** An id from a caller: non-empty, bounded, control characters stripped. */
export function asId(v: unknown): string {
  return asString(v, "id", 64);
}
