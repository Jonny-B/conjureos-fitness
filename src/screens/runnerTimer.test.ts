import { describe, expect, it } from "vitest";
import { heldSeconds, liveSeconds } from "./runnerTimer";

describe("liveSeconds", () => {
  it("reads the countdown only for the step it belongs to", () => {
    expect(liveSeconds({ index: 1, left: 30 }, 1)).toBe(30);
    expect(liveSeconds(null, 0)).toBeNull();
  });

  it("does not read the 0 left by a finished rest as the next set's countdown", () => {
    // rest (index 1) just hit 0 and advanced to set 2 (index 2): the stale 0
    // must not look like a finished countdown, or the next set auto-skips.
    const stale = { index: 1, left: 0 };
    expect(liveSeconds(stale, 2)).toBeNull();
    expect(liveSeconds(stale, 1)).toBe(0);
  });
});

describe("heldSeconds", () => {
  it("is 0 when a timed set is skipped before anything was held", () => {
    expect(heldSeconds(45, 45)).toBe(0);
    expect(heldSeconds(45, null)).toBe(0);
  });

  it("records the real elapsed seconds on an early skip", () => {
    expect(heldSeconds(45, 43)).toBe(2);
  });

  it("records the full duration when the countdown reached 0", () => {
    expect(heldSeconds(45, 0)).toBe(45);
  });

  it("stays within 0..duration", () => {
    expect(heldSeconds(45, -3)).toBe(45);
    expect(heldSeconds(45, 60)).toBe(0);
  });
});
