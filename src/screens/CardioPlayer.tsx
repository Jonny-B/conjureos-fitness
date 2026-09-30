import { useState } from "react";
import type { CardioActual, Profile, Workout } from "../types";
import { useGpsTracker } from "../features/cardio/tracker";
import { distanceUnit, fmtClock, fmtPace, kmToMi, paceUnit } from "../features/units";
import { ManualCardioEntry } from "../components/ManualCardioEntry";
import { ChevronLeft } from "../components/icons";

interface Props {
  workout: Workout;
  units: Profile["units"];
  onFinish: (cardio: CardioActual) => void;
  onCancel: () => void;
}

/** A GPS result with no distance or no time is not a workout: saving it would
 *  record an empty session (and a 0 km benchmark baseline). */
export function isEmptyGpsRun(c: Pick<CardioActual, "distanceKm" | "durationSec">): boolean {
  return !(c.distanceKm > 0) || !(c.durationSec > 0);
}

/** Split chip text. Splits are per km (the tracker's unit), and a split is a
 *  duration, not a pace, so it is labelled km and shown as a clock for all units. */
export function splitChipLabel(index: number, splitSec: number): string {
  return `km ${index + 1} · ${fmtClock(splitSec)}`;
}

/** Cardio (run/bike) screen: live GPS distance/pace/time/splits, with a manual
 *  distance+duration path always reachable. */
export function CardioPlayer({ workout, units, onFinish, onCancel }: Props) {
  const { available, state, start, pause, resume, stop } = useGpsTracker();
  const [manual, setManual] = useState(!available);
  const [started, setStarted] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [emptyNotice, setEmptyNotice] = useState(false);
  const distDisplay = units === "imperial" ? kmToMi(state.distanceKm) : state.distanceKm;

  const finishGps = () => {
    const result = stop();
    if (isEmptyGpsRun(result)) {
      // Nothing worth saving: stop() already released the watch, so offer manual entry.
      setStarted(false);
      setEmptyNotice(true);
      setManual(true);
      return;
    }
    onFinish(result);
  };

  // The top-left button must never silently throw away a run that has data.
  const hasRunData = started && (state.distanceKm > 0 || state.elapsedSec > 0);
  const leave = () => (hasRunData ? setConfirmDiscard(true) : onCancel());

  const discardConfirm = confirmDiscard && (
    <div className="notice notice-error" role="alertdialog" aria-label="Discard this run?">
      <div>Discard this run? Distance and route will be lost.</div>
      <div className="wizard-nav">
        <button className="btn" onClick={() => setConfirmDiscard(false)}>Keep going</button>
        <button className="btn danger" onClick={onCancel}>Discard</button>
      </div>
    </div>
  );
  const backLabel = hasRunData ? "Discard" : "Back";

  if (manual) {
    return (
      <div className="cardio-player">
        <div className="player-top">
          <button className="link-btn back-link" onClick={leave}>
            <ChevronLeft size={16} /> {backLabel}
          </button>
          {available && (
            <button className="link-btn" onClick={() => { setEmptyNotice(false); setManual(false); }}>Use GPS</button>
          )}
        </div>
        <h2 className="cardio-title">{workout.name}</h2>
        {discardConfirm}
        {emptyNotice && (
          <div className="notice notice-error">
            No GPS distance was recorded, so there is nothing to save. Enter your distance and time below.
          </div>
        )}
        <ManualCardioEntry units={units} onSave={onFinish} onCancel={leave} />
      </div>
    );
  }

  return (
    <div className="cardio-player">
      <div className="player-top">
        <button className="link-btn back-link" onClick={leave}>
          <ChevronLeft size={16} /> {backLabel}
        </button>
        <button className="link-btn" onClick={() => setManual(true)}>Enter manually</button>
      </div>

      {discardConfirm}

      <div className="cardio-stats">
        <div className="cardio-distance">
          {distDisplay.toFixed(2)}
          <span className="cardio-unit">{distanceUnit(units)}</span>
        </div>
        <div className="cardio-sub">
          <div className="cardio-metric">
            <span className="cardio-val">{fmtClock(state.elapsedSec)}</span>
            <span className="cardio-lbl">time</span>
          </div>
          <div className="cardio-metric">
            <span className="cardio-val">{fmtPace(state.paceSecPerKm, units)}</span>
            <span className="cardio-lbl">{paceUnit(units)}</span>
          </div>
        </div>
        {state.autoPaused && <div className="cardio-autopause">Auto-paused</div>}
        {started && !state.gps && (
          state.gpsError
            ? <div className="muted small">GPS unavailable: {state.gpsError}. You can enter your run manually.</div>
            : <div className="muted small">Waiting for GPS…</div>
        )}
      </div>

      {state.splits.length > 0 && (
        <div className="cardio-splits">
          {state.splits.map((s, i) => (
            <span key={i} className="split-chip">
              {splitChipLabel(i, s)}
            </span>
          ))}
        </div>
      )}

      <div className="player-controls">
        {!started ? (
          <button className="btn primary block" onClick={() => { setStarted(true); start(); }}>Start</button>
        ) : (
          <>
            <button className="btn" onClick={() => (state.running ? pause() : resume())}>
              {state.running ? "Pause" : "Resume"}
            </button>
            <button className="btn primary" onClick={finishGps}>Finish</button>
          </>
        )}
      </div>
    </div>
  );
}
