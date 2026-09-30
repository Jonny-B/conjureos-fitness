import { useCallback, useEffect, useRef, useState } from "react";
import type { CardioActual } from "../../types";
import { haversineMeters, isLocationAvailable, watchLocation, type LocationSample } from "../../bridge/location";

/** Live state of a GPS-tracked cardio session, recomputed on every fix. */
export interface CardioTrackState {
  distanceKm: number;
  elapsedSec: number;
  /** Seconds per km, or null until enough distance to be meaningful. */
  paceSecPerKm: number | null;
  /** Completed-km split times, seconds. */
  splits: number[];
  running: boolean;
  autoPaused: boolean;
  /** True once at least one GPS fix has arrived. */
  gps: boolean;
  /** Last location error (denied permission, no source), cleared by the next fix. */
  gpsError: string | null;
}

const MIN_MOVE_M = 4; // ignore sub-jitter movement
const MAX_JUMP_M = 120; // ignore a single bad fix that teleports
const AUTOPAUSE_MS = 10000; // no movement this long → pause the clock

const INITIAL: CardioTrackState = {
  distanceKm: 0,
  elapsedSec: 0,
  paceSecPerKm: null,
  splits: [],
  running: false,
  autoPaused: false,
  gps: false,
  gpsError: null,
};

/**
 * Accept/accumulate step for one fix. The anchor stays on the last accepted
 * point, so sub-threshold movement (a 1 Hz runner, a walker, 2.5 s native
 * polls) builds up until it clears the jitter threshold instead of being thrown
 * away. A fix rejected as a teleport still becomes the anchor so a bad fix
 * can resync. `addedM` is the distance to count (0 when nothing is accepted).
 */
export function advanceAnchor(
  anchor: LocationSample | null,
  s: LocationSample,
): { anchor: LocationSample; addedM: number; moved: boolean } {
  if (!anchor) return { anchor: s, addedM: 0, moved: false };
  const d = haversineMeters(anchor, s);
  const threshold = Math.max(MIN_MOVE_M, (s.accuracy ?? 20) * 0.5);
  if (d < threshold) return { anchor, addedM: 0, moved: false };
  if (d >= MAX_JUMP_M) return { anchor: s, addedM: 0, moved: false };
  return { anchor: s, addedM: d, moved: true };
}

/**
 * GPS run/bike tracker. Distance via haversine over the position stream; elapsed
 * from `Date.now()` deltas (not tick counts, so backgrounding doesn't inflate
 * time); per-km splits; auto-pause when movement stalls; best-effort wakeLock.
 */
export function useGpsTracker() {
  const available = isLocationAvailable();
  const [state, setState] = useState<CardioTrackState>(INITIAL);

  const runningRef = useRef(false);
  const autoPausedRef = useRef(false);
  const distMRef = useRef(0);
  const elapsedMsRef = useRef(0);
  const lastTickRef = useRef(0);
  const lastSampleRef = useRef<LocationSample | null>(null);
  const lastMoveRef = useRef(0);
  const nextSplitKmRef = useRef(1);
  const lastSplitElapsedRef = useRef(0);
  const splitsRef = useRef<number[]>([]);
  const trackRef = useRef<LocationSample[]>([]);
  const gpsErrorRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<{ release: () => void } | null>(null);

  const publish = useCallback(() => {
    const km = distMRef.current / 1000;
    const sec = Math.round(elapsedMsRef.current / 1000);
    setState({
      distanceKm: km,
      elapsedSec: sec,
      paceSecPerKm: km > 0.05 ? sec / km : null,
      splits: [...splitsRef.current],
      running: runningRef.current,
      autoPaused: autoPausedRef.current,
      gps: trackRef.current.length > 0,
      gpsError: gpsErrorRef.current,
    });
  }, []);

  const onSample = useCallback(
    (s: LocationSample) => {
      trackRef.current.push(s);
      gpsErrorRef.current = null;
      if (!runningRef.current) {
        lastSampleRef.current = s; // while paused the anchor follows every fix
        publish();
        return;
      }
      const step = advanceAnchor(lastSampleRef.current, s);
      if (!lastSampleRef.current) lastMoveRef.current = Date.now();
      lastSampleRef.current = step.anchor;
      if (step.moved) {
        distMRef.current += step.addedM;
        lastMoveRef.current = Date.now();
        autoPausedRef.current = false;
        const km = distMRef.current / 1000;
        while (km >= nextSplitKmRef.current) {
          const sec = Math.round(elapsedMsRef.current / 1000);
          splitsRef.current.push(sec - lastSplitElapsedRef.current);
          lastSplitElapsedRef.current = sec;
          nextSplitKmRef.current += 1;
        }
      }
      publish();
    },
    [publish],
  );

  // 1 Hz clock: accrue elapsed by wall-clock delta, auto-pause on stall.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!runningRef.current) {
        lastTickRef.current = Date.now();
        return;
      }
      const now = Date.now();
      if (lastMoveRef.current && now - lastMoveRef.current > AUTOPAUSE_MS) autoPausedRef.current = true;
      if (!autoPausedRef.current) {
        const dt = lastTickRef.current ? now - lastTickRef.current : 0;
        elapsedMsRef.current += Math.min(Math.max(dt, 0), 2000); // clamp big/negative gaps
      }
      lastTickRef.current = now;
      publish();
    }, 1000);
    return () => window.clearInterval(id);
  }, [publish]);

  const requestWake = () => {
    try {
      const wl = (navigator as { wakeLock?: { request: (t: string) => Promise<{ release: () => void }> } }).wakeLock;
      wl?.request("screen").then((s) => (wakeRef.current = s)).catch(() => {});
    } catch {
      /* best-effort */
    }
  };

  const start = useCallback(() => {
    if (!unsubRef.current) {
      // A fresh session (the first Start, or Start again after a Finish that
      // saved nothing): don't carry the last attempt's time, distance, splits,
      // track or anchor into this one.
      distMRef.current = 0;
      elapsedMsRef.current = 0;
      lastSampleRef.current = null;
      nextSplitKmRef.current = 1;
      lastSplitElapsedRef.current = 0;
      splitsRef.current = [];
      trackRef.current = [];
      autoPausedRef.current = false;
    }
    runningRef.current = true;
    lastTickRef.current = Date.now();
    lastMoveRef.current = Date.now();
    gpsErrorRef.current = null; // a restart (e.g. Use GPS after an empty run) retries from a clean slate
    if (!unsubRef.current) {
      unsubRef.current = watchLocation(onSample, (message) => {
        gpsErrorRef.current = message;
        publish();
      });
    }
    requestWake();
    publish();
  }, [onSample, publish]);

  const pause = useCallback(() => {
    runningRef.current = false;
    publish();
  }, [publish]);

  const resume = useCallback(() => {
    runningRef.current = true;
    autoPausedRef.current = false;
    lastTickRef.current = Date.now();
    lastMoveRef.current = Date.now();
    publish();
  }, [publish]);

  const stop = useCallback((): CardioActual => {
    runningRef.current = false;
    unsubRef.current?.();
    unsubRef.current = null;
    wakeRef.current?.release?.();
    wakeRef.current = null;
    const km = distMRef.current / 1000;
    const sec = Math.round(elapsedMsRef.current / 1000);
    publish();
    return {
      distanceKm: Math.round(km * 1000) / 1000,
      durationSec: sec,
      avgPaceSecPerKm: km > 0.05 ? Math.round(sec / km) : undefined,
      source: "gps",
      splits: [...splitsRef.current],
      track: trackRef.current.map((t) => ({ lat: t.lat, lon: t.lon, t: t.t, accuracy: t.accuracy })),
    };
  }, [publish]);

  useEffect(
    () => () => {
      unsubRef.current?.();
      wakeRef.current?.release?.();
    },
    [],
  );

  return { available, state, start, pause, resume, stop };
}
