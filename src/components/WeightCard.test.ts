import { describe, expect, it } from "vitest";
import type { Profile, WeightEntry } from "../types";
import { pickWeightKg } from "./WeightCard";

const w = (weightKg: number, date = "2026-07-16"): WeightEntry => ({ date, weightKg });
const profile = (weightKg: number): Profile => ({ weightKg }) as Profile;

describe("pickWeightKg", () => {
  it("uses the newest weigh-in when one exists (not from profile)", () => {
    expect(pickWeightKg([w(78), w(80)], profile(90))).toEqual({ kg: 78, fromProfile: false });
  });

  it("falls back to the plan/profile weight when there are no weigh-ins", () => {
    expect(pickWeightKg([], profile(80))).toEqual({ kg: 80, fromProfile: true });
  });

  it("returns null (→ friendly prompt, no dash) when nothing is known", () => {
    expect(pickWeightKg([], null)).toEqual({ kg: null, fromProfile: false });
    expect(pickWeightKg([], profile(0))).toEqual({ kg: null, fromProfile: false });
  });
});
