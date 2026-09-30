/**
 * Validators for cross-app action params. Params come from other, untrusted
 * apps, so every field is type-checked, length-capped and range-checked before
 * it reaches the repository. Used by the actions in fitnessActions.ts.
 */

import { todayISO } from "../features/dates";

export function asObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("params must be an object");
  return v as Record<string, unknown>;
}
export function asString(v: unknown, field: string, max: number): string {
  if (typeof v !== "string") throw new Error(`params.${field} must be a string`);
  // Control characters (newline, tab, ...) become spaces, not nothing, so
  // "Easy run\nhills" doesn't glue into "Easy runhills"; then runs collapse.
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\x00-\x1F\x7F]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!t) throw new Error(`params.${field} cannot be empty`);
  if (t.length > max) throw new Error(`params.${field} exceeds ${max} chars`);
  return t;
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
 * counts or measures something (a list limit, a workout's minutes or
 * distance), "none" is a different request than "a little" — the caller
 * should just not make the call — so it must never be silently reinterpreted
 * as a default or a minimum. A positive value that falls outside the bound,
 * on the other hand, is safe to clamp to the nearer edge: capping an excessive
 * "durationMin: 9999" or rounding "distanceKm: 0.001" up to the smallest
 * representable amount doesn't invent an amount the caller never stated, it
 * just refuses to honor an amount stated too precisely or too generously.
 * Applied consistently at every "explicit but out of range" numeric field on
 * this surface — see listWorkouts (limit) and logWorkout (durationMin,
 * distanceKm).
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
  // because a workout logged under a date the app's own UI can never navigate
  // to (the Workouts tab and listWorkouts walk real calendar days) is written
  // and then permanently invisible.
  const roundTrip = new Date(y, mo - 1, d);
  if (roundTrip.getFullYear() !== y || roundTrip.getMonth() !== mo - 1 || roundTrip.getDate() !== d) {
    throw new Error(`params.${field} must be a real calendar date (YYYY-MM-DD)`);
  }
  return s;
}
