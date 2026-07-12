import { useState } from "react";
import type { CardioActual, Workout } from "../types";
import { useGpsTracker } from "../features/cardio/tracker";
import { ManualCardioEntry } from "../components/ManualCardioEntry";
import { ChevronLeft } from "../components/icons";

function fmtPace(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return "—:—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}
function fmtTime(total: number): string {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

interface Props {
  workout: Workout;
  onFinish: (cardio: CardioActual) => void;
  onCancel: () => void;
}

/** Cardio (run/bike) screen: live GPS distance/pace/time/splits, with a manual
 *  distance+duration path always reachable. */
export function CardioPlayer({ workout, onFinish, onCancel }: Props) {
  const { available, state, start, pause, resume, stop } = useGpsTracker();
  const [manual, setManual] = useState(!available);
  const [started, setStarted] = useState(false);

  if (manual) {
    return (
      <div className="cardio-player">
        <div className="player-top">
          <button className="link-btn back-link" onClick={onCancel}>
            <ChevronLeft size={16} /> End
          </button>
          {available && (
            <button className="link-btn" onClick={() => setManual(false)}>Use GPS</button>
          )}
        </div>
        <h2 className="cardio-title">{workout.name}</h2>
        <ManualCardioEntry onSave={onFinish} onCancel={onCancel} />
      </div>
    );
  }

  return (
    <div className="cardio-player">
      <div className="player-top">
        <button className="link-btn back-link" onClick={onCancel}>
          <ChevronLeft size={16} /> End
        </button>
        <button className="link-btn" onClick={() => setManual(true)}>Enter manually</button>
      </div>

      <div className="cardio-stats">
        <div className="cardio-distance">
          {state.distanceKm.toFixed(2)}
          <span className="cardio-unit">km</span>
        </div>
        <div className="cardio-sub">
          <div className="cardio-metric">
            <span className="cardio-val">{fmtTime(state.elapsedSec)}</span>
            <span className="cardio-lbl">time</span>
          </div>
          <div className="cardio-metric">
            <span className="cardio-val">{fmtPace(state.paceSecPerKm)}</span>
            <span className="cardio-lbl">/km</span>
          </div>
        </div>
        {state.autoPaused && <div className="cardio-autopause">Auto-paused</div>}
        {started && !state.gps && <div className="muted small">Waiting for GPS…</div>}
      </div>

      {state.splits.length > 0 && (
        <div className="cardio-splits">
          {state.splits.map((s, i) => (
            <span key={i} className="split-chip">km {i + 1} · {fmtPace(s)}</span>
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
            <button className="btn primary" onClick={() => onFinish(stop())}>Finish</button>
          </>
        )}
      </div>
    </div>
  );
}
