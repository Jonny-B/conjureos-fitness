import { describe, expect, it } from "vitest";
import { isEmptyGpsRun, splitChipLabel } from "./CardioPlayer";

describe("isEmptyGpsRun", () => {
  it("flags a result with no distance (denied permission, no fix)", () => {
    expect(isEmptyGpsRun({ distanceKm: 0, durationSec: 11 })).toBe(true);
  });

  it("flags a result with no time", () => {
    expect(isEmptyGpsRun({ distanceKm: 0.4, durationSec: 0 })).toBe(true);
  });

  it("flags NaN", () => {
    expect(isEmptyGpsRun({ distanceKm: NaN, durationSec: 30 })).toBe(true);
  });

  it("accepts a real run", () => {
    expect(isEmptyGpsRun({ distanceKm: 0.2, durationSec: 60 })).toBe(false);
  });
});

describe("splitChipLabel", () => {
  it("labels per-km splits as km with the raw split time, regardless of units", () => {
    // A 300 s km used to render as 'mi 1 · 8:03' for imperial users.
    expect(splitChipLabel(0, 300)).toBe("km 1 · 5:00");
    expect(splitChipLabel(4, 3725)).toBe("km 5 · 1:02:05");
  });
});
