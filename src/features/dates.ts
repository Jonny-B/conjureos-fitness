/**
 * Calendar-date helpers. Dates are local YYYY-MM-DD strings: a workout belongs
 * to the day the user did it, not to a UTC day.
 */

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Shift a YYYY-MM-DD date by whole days, returning a new YYYY-MM-DD. */
export function shiftDate(dateISO: string, deltaDays: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  return todayISO(dt);
}
