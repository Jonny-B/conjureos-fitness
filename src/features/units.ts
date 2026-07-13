/**
 * Unit conversion + formatting (WU). Storage is ALWAYS metric (kg, cm, km) — as
 * the Profile.units comment dictates. These convert only at the input/display
 * edges. Calories (kcal) + macros (grams) are unit-agnostic and not touched.
 */

import type { Profile } from "../types";

type Units = Profile["units"];

const LB_PER_KG = 2.2046226218;
const IN_PER_CM = 1 / 2.54;
const MI_PER_KM = 0.621371;

export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;
export const cmToIn = (cm: number) => cm * IN_PER_CM;
export const inToCm = (inch: number) => inch / IN_PER_CM;
export const kmToMi = (km: number) => km * MI_PER_KM;
export const miToKm = (mi: number) => mi / MI_PER_KM;

export const weightUnit = (u: Units) => (u === "imperial" ? "lb" : "kg");
export const heightUnit = (u: Units) => (u === "imperial" ? "in" : "cm");
export const distanceUnit = (u: Units) => (u === "imperial" ? "mi" : "km");
export const paceUnit = (u: Units) => (u === "imperial" ? "/mi" : "/km");

/** kg → the display number in the user's units (rounded for a field). */
export const weightToDisplay = (kg: number, u: Units) =>
  u === "imperial" ? Math.round(kgToLb(kg)) : Math.round(kg * 10) / 10;
/** A display weight (in the user's units) → kg for storage. */
export const weightToKg = (v: number, u: Units) => (u === "imperial" ? lbToKg(v) : v);

export const heightToDisplay = (cm: number, u: Units) =>
  u === "imperial" ? Math.round(cmToIn(cm)) : Math.round(cm);
export const heightToCm = (v: number, u: Units) => (u === "imperial" ? inToCm(v) : v);

export function fmtWeight(kg: number, u: Units): string {
  return u === "imperial" ? `${Math.round(kgToLb(kg))} lb` : `${Math.round(kg * 10) / 10} kg`;
}

export function fmtHeight(cm: number, u: Units): string {
  if (u === "imperial") {
    const totalIn = Math.round(cmToIn(cm));
    return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
  }
  return `${Math.round(cm)} cm`;
}

export function fmtDistance(km: number, u: Units): string {
  return u === "imperial" ? `${kmToMi(km).toFixed(2)} mi` : `${km.toFixed(2)} km`;
}

/** Pace (stored as sec/km) formatted per the user's distance unit. */
export function fmtPace(secPerKm: number | null | undefined, u: Units): string {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return "—:—";
  const per = u === "imperial" ? secPerKm / MI_PER_KM : secPerKm;
  const m = Math.floor(per / 60);
  const s = Math.round(per % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
