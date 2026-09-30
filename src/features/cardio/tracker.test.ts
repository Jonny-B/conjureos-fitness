import { describe, expect, it } from "vitest";
import { haversineMeters, type LocationSample } from "../../bridge/location";
import { advanceAnchor } from "./tracker";

const M_PER_DEG_LAT = 111194.9; // 6371000 * pi / 180

/** Sample `north` metres north of the origin. */
const at = (north: number, accuracy?: number, t = 0): LocationSample => ({
  lat: 40 + north / M_PER_DEG_LAT,
  lon: -75,
  t,
  accuracy,
});

/** Feed a stream through the accept/accumulate step, like onSample does while running. */
function run(samples: LocationSample[]) {
  let anchor: LocationSample | null = null;
  let totalM = 0;
  for (const s of samples) {
    const step = advanceAnchor(anchor, s);
    anchor = step.anchor;
    totalM += step.addedM;
  }
  return totalM;
}

describe("advanceAnchor", () => {
  it("sets the anchor on the first fix without adding distance", () => {
    const s = at(0, 5);
    expect(advanceAnchor(null, s)).toEqual({ anchor: s, addedM: 0, moved: false });
  });

  it("counts a 5:00/km runner at 1 Hz with 5 m accuracy (3.33 m per fix, under the 4 m threshold)", () => {
    const samples = Array.from({ length: 61 }, (_, i) => at(i * 3.33, 5, i * 1000));
    const total = run(samples);
    // 60 fixes * 3.33 m = 200 m; the last <4 m of movement may still be pending.
    expect(total).toBeGreaterThan(195);
    expect(total).toBeLessThanOrEqual(200);
  });

  it("counts a walker at 1.4 m/s at 1 Hz", () => {
    const samples = Array.from({ length: 61 }, (_, i) => at(i * 1.4, 5, i * 1000));
    const total = run(samples);
    expect(total).toBeGreaterThan(80);
  });

  it("counts a jog on the native 2.5 s poll with unknown accuracy (8.3 m per poll, 10 m threshold)", () => {
    const samples = Array.from({ length: 41 }, (_, i) => at(i * 8.33, undefined, i * 2500));
    const total = run(samples);
    expect(total).toBeGreaterThan(300);
  });

  it("keeps the anchor on the last accepted point for sub-threshold movement", () => {
    const a = at(0, 5);
    const step = advanceAnchor(a, at(3, 5));
    expect(step.anchor).toBe(a);
    expect(step.addedM).toBe(0);
    expect(step.moved).toBe(false);
  });

  it("ignores stationary jitter and never accumulates it into distance", () => {
    // Bounce +-1.5 m (3 m swing, under the 4 m threshold) around a point for 5 minutes.
    const samples = Array.from({ length: 300 }, (_, i) => at(i % 2 === 0 ? 1.5 : -1.5, 5, i * 1000));
    expect(run(samples)).toBe(0);
  });

  it("adds the distance from the anchor, not from the previous fix", () => {
    const a = at(0, 5);
    const s1 = at(3, 5);
    const s2 = at(6, 5);
    const step1 = advanceAnchor(a, s1);
    const step2 = advanceAnchor(step1.anchor, s2);
    expect(step2.moved).toBe(true);
    expect(step2.addedM).toBeCloseTo(haversineMeters(a, s2), 6);
    expect(step2.anchor).toBe(s2);
  });

  it("rejects a teleporting fix but re-anchors on it so tracking resyncs", () => {
    const a = at(0, 5);
    const jump = at(500, 5);
    const step = advanceAnchor(a, jump);
    expect(step.addedM).toBe(0);
    expect(step.moved).toBe(false);
    expect(step.anchor).toBe(jump);
    // The next normal fix is measured from the new location, not from 500 m away.
    const next = advanceAnchor(step.anchor, at(505, 5));
    expect(next.moved).toBe(true);
    expect(next.addedM).toBeCloseTo(5, 0);
  });

  it("scales the jitter threshold with poor accuracy", () => {
    // accuracy 30 m -> threshold 15 m: a 10 m move is not accepted.
    expect(advanceAnchor(at(0, 30), at(10, 30)).moved).toBe(false);
    expect(advanceAnchor(at(0, 30), at(16, 30)).moved).toBe(true);
  });
});
