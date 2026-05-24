import { useCallback, useEffect, useRef, useState } from "react";
import type { Workout } from "../types";
import { BUILT_IN_WORKOUTS, buildSteps, type PlayerStep } from "../features/workouts";

export function WorkoutsScreen() {
  const [active, setActive] = useState<Workout | null>(null);

  if (active) return <WorkoutPlayer workout={active} onExit={() => setActive(null)} />;

  return (
    <div className="workouts">
      <h1 className="screen-title">Workouts</h1>
      <ul className="workout-list">
        {BUILT_IN_WORKOUTS.map((w) => (
          <li key={w.id}>
            <button className="workout-card" onClick={() => setActive(w)}>
              <div className="workout-name">{w.name}</div>
              <div className="workout-summary">{w.summary}</div>
              <div className="workout-meta">
                {w.exercises.length} exercises · {w.exercises.reduce((s, e) => s + e.sets.length, 0)} sets
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Guided player with set + rest timers ─────────────────────────────────

function WorkoutPlayer({ workout, onExit }: { workout: Workout; onExit: () => void }) {
  const stepsRef = useRef<PlayerStep[]>(buildSteps(workout));
  const steps = stepsRef.current;

  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [running, setRunning] = useState(true);
  const step = steps[index];

  const beep = useBeep();

  const advance = useCallback(() => {
    setIndex((i) => {
      const next = i + 1;
      if (next >= steps.length) return i; // hold on the last step; "Finish" exits
      return next;
    });
  }, [steps.length]);

  // Initialize the countdown whenever the step changes. Timed work + all rest
  // steps count down; rep-based work waits for the user's "Done set" tap.
  useEffect(() => {
    if (!step) return;
    if (step.kind === "rest") setSecondsLeft(step.durationSec);
    else if (step.durationSec != null) setSecondsLeft(step.durationSec);
    else setSecondsLeft(null);
    setRunning(true);
  }, [index, step]);

  // The 1 Hz countdown tick.
  useEffect(() => {
    if (!running || secondsLeft == null) return;
    if (secondsLeft <= 0) {
      beep(step?.kind === "rest" ? "high" : "low");
      advance();
      return;
    }
    if (secondsLeft <= 3) beep("tick");
    const t = setTimeout(() => setSecondsLeft((s) => (s == null ? s : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [running, secondsLeft, advance, beep, step?.kind]);

  if (!step) return null;

  const isLast = index === steps.length - 1;
  const totalWork = steps.filter((s) => s.kind === "work").length;
  const workDone = steps.slice(0, index + 1).filter((s) => s.kind === "work").length;

  return (
    <div className={`player ${step.kind}`}>
      <div className="player-top">
        <button className="link-btn" onClick={onExit}>
          ‹ End
        </button>
        <span className="player-progress">
          Set {Math.min(workDone, totalWork)} / {totalWork}
        </span>
      </div>

      {step.kind === "work" ? (
        <div className="player-body">
          <div className="player-phase">EXERCISE</div>
          <h2 className="player-exercise">{step.exerciseName}</h2>
          <div className="player-setline">
            Set {step.setIndex + 1} of {step.setCount}
            {step.weightKg ? ` · ${step.weightKg} kg` : ""}
          </div>

          {step.durationSec != null ? (
            <div className="timer big">{fmt(secondsLeft ?? step.durationSec)}</div>
          ) : (
            <div className="timer big reps">{step.reps} reps</div>
          )}

          {step.notes && <div className="player-notes">{step.notes}</div>}
        </div>
      ) : (
        <div className="player-body">
          <div className="player-phase">REST</div>
          <div className="timer big rest">{fmt(secondsLeft ?? step.durationSec)}</div>
          <div className="player-next">Next: {step.nextExerciseName}</div>
        </div>
      )}

      <div className="player-controls">
        {step.kind === "work" && step.durationSec == null ? (
          <button className="btn primary block" onClick={isLast ? onExit : advance}>
            {isLast ? "Finish" : "Done set"}
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => setRunning((r) => !r)}>
              {running ? "Pause" : "Resume"}
            </button>
            <button className="btn" onClick={isLast ? onExit : advance}>
              {isLast ? "Finish" : "Skip"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function fmt(total: number): string {
  const s = Math.max(0, Math.round(total));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `0:${String(r).padStart(2, "0")}`;
}

/** WebAudio cue generator — short beeps for ticks + phase transitions. No
 *  asset files; tones are synthesized so the bundle stays tiny. */
function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null);
  return useCallback((kind: "tick" | "low" | "high") => {
    try {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = (ctxRef.current ??= new Ctor());
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = kind === "high" ? 880 : kind === "low" ? 440 : 660;
      gain.gain.value = 0.0008;
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + (kind === "tick" ? 0.08 : 0.2));
      osc.start(now);
      osc.stop(now + (kind === "tick" ? 0.09 : 0.22));
    } catch {
      /* audio is best-effort */
    }
  }, []);
}
