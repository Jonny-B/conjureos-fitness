import { describe, expect, it } from "vitest";
import { nextWaterMl } from "./JournalEntrySheet";
import { fmtWater, flOzToMl, mlToFlOz } from "../features/water";

// Simulates what the sheet does when it opens: seed `amount` by parsing the
// number back out of the rounded display string, exactly like the
// `startAmount` line in JournalEntrySheet does from `event.detail`.
const displayedAmount = (ml: number, units: "metric" | "imperial"): number =>
  Number(/[\d.]+/.exec(fmtWater(ml, units))?.[0] ?? 0);

describe("nextWaterMl — open, don't touch, save must be a no-op", () => {
  it("never converts an untouched amount, regardless of the drift a round-trip would introduce", () => {
    // These are exactly the corrupting cases from the bug report: displaying
    // then blindly converting back would give 1005 / 237 / 59, not the
    // original. Confirm the drift is real (so this test would have caught
    // the bug), then confirm nextWaterMl refuses to reproduce it.
    for (const ml of [1000, 250, 50]) {
      const shown = displayedAmount(ml, "imperial");
      const naiveRoundTrip = Math.round(flOzToMl(shown));
      expect(naiveRoundTrip).not.toBe(ml); // the bug, still present in a bare round-trip
      expect(nextWaterMl(shown, /* edited */ false, "imperial")).toBeUndefined();
    }
  });

  it("metric round-trips cleanly even so — open and save unchanged is a no-op either way", () => {
    for (const ml of [1000, 250, 50, 2000]) {
      const shown = displayedAmount(ml, "metric");
      expect(shown).toBe(ml); // metric display has no rounding loss to begin with
      expect(nextWaterMl(shown, false, "metric")).toBeUndefined();
    }
  });

  it("does convert when the user actually changes the amount", () => {
    expect(nextWaterMl(16, true, "imperial")).toBe(Math.round(flOzToMl(16)));
    expect(nextWaterMl(500, true, "metric")).toBe(500);
  });

  it("treats a zero or missing edited amount as nothing to save", () => {
    expect(nextWaterMl(0, true, "imperial")).toBeUndefined();
    expect(nextWaterMl(undefined, true, "metric")).toBeUndefined();
  });

  it("sanity: mlToFlOz/flOzToMl are true inverses (the drift is rounding, not the formula)", () => {
    expect(mlToFlOz(flOzToMl(34))).toBeCloseTo(34, 9);
  });
});
