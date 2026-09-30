import { describe, expect, it, vi } from "vitest";
import type { LocationSample } from "../../bridge/location";

// Drive the hook without a renderer: refs persist across calls on one instance.
vi.mock("react", () => ({
  useState: <T,>(init: T) => [init, () => {}],
  useRef: <T,>(init: T) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useEffect: () => {},
}));

let feed: ((s: LocationSample) => void) | null = null;
vi.mock("../../bridge/location", async (orig) => ({
  ...(await orig<typeof import("../../bridge/location")>()),
  isLocationAvailable: () => true,
  watchLocation: (onSample: (s: LocationSample) => void) => {
    feed = onSample;
    return () => {
      feed = null;
    };
  },
}));

const { useGpsTracker } = await import("./tracker");

const M_PER_DEG_LAT = 111194.9;
const at = (north: number, t: number): LocationSample => ({ lat: 40 + north / M_PER_DEG_LAT, lon: -75, t, accuracy: 5 });

describe("useGpsTracker restart", () => {
  it("starts a new session from zero after a stop, without the last attempt's distance or track", () => {
    const tracker = useGpsTracker();
    tracker.start();
    for (let i = 0; i <= 50; i++) feed!(at(i * 20, i * 1000)); // 1 km
    const first = tracker.stop();
    expect(first.distanceKm).toBeGreaterThan(0.9);
    expect(first.track!.length).toBeGreaterThan(0);

    tracker.start();
    feed!(at(5000, 100_000)); // a far-away first fix of the new attempt: only an anchor
    const second = tracker.stop();
    expect(second.distanceKm).toBe(0);
    expect(second.track).toHaveLength(1);
    expect(second.splits).toEqual([]);
  });
});
