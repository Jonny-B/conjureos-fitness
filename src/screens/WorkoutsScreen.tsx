import { useCallback, useEffect, useRef, useState } from "react";
import type { ExerciseActual, Workout } from "../types";
import { BUILT_IN_WORKOUTS, buildSteps, newSessionFrom, type PlayerStep } from "../features/workouts";
import { normalizeExerciseKey } from "../features/explainers/normalizeKey";
import { getRepository } from "../data/repository";
import { ProgressRing } from "../components/rings";
import { ChevronLeft, PlayIcon } from "../components/icons";

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
              <div className="workout-card-text">
                <div className="workout-name">{w.name}</div>
                <div className="workout-summary">{w.summary}</div>
                <div className="workout-meta">
                  {w.exercises.length} exercises · {w.exercises.reduce((s, e) => s + e.sets.length, 0)} sets
                </div>
              </div>
              <span className="workout-play" aria-hidden>
                <PlayIcon size={18} />
              </span>
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

  // Recorded actuals accumulate here as the player advances. W0 captures the
  // prescribed reps/weight/duration + per-set timestamps; W1 swaps in the
  // user's entered values via SetRecorder. `order` keeps exercises in workout
  // order for the persisted byExercise.
  const actualsRef = useRef<Map<string, ExerciseActual & { order: number }>>(new Map());
  const recordedRef = useRef<Set<number>>(new Set());
  const stepStartRef = useRef<string>(new Date().toISOString());
  const indexRef = useRef(0);

  const recordStep = useCallback(
    (i: number) => {
      const s = steps[i];
      if (!s || s.kind !== "work" || recordedRef.current.has(i)) return;
      recordedRef.current.add(i);
      const key = normalizeExerciseKey(s.exerciseName);
      const bucket =
        actualsRef.current.get(key) ??
        { exerciseKey: key, name: s.exerciseName, sets: [], order: s.exerciseIndex };
      bucket.sets.push({
        reps: s.reps ?? undefined,
        weightKg: s.weightKg,
        durationSec: s.durationSec ?? undefined,
        startedAt: stepStartRef.current,
        completedAt: new Date().toISOString(),
      });
      actualsRef.current.set(key, bucket);
    },
    [steps],
  );

  const advance = useCallback(() => {
    recordStep(indexRef.current);
    setIndex((i) => {
      const next = i + 1;
      if (next >= steps.length) return i; // hold on the last step; "Finish" exits
      return next;
    });
  }, [recordStep, steps.length]);

  // Persist the session (best-effort) then return to the list. Records the step
  // being left first, so the final set is captured. Saves only if something was
  // actually done, so an immediate back-out doesn't write an empty session.
  const finish = useCallback(async () => {
    recordStep(indexRef.current);
    const byExercise: ExerciseActual[] = [...actualsRef.current.values()]
      .sort((a, b) => a.order - b.order)
      .map((e) => ({ exerciseKey: e.exerciseKey, name: e.name, sets: e.sets }));
    if (byExercise.length > 0) {
      try {
        const repo = await getRepository();
        await repo.saveWorkoutSession(newSessionFrom(workout, byExercise));
      } catch {
        /* mock persists; Supabase throws PLAN_REQUIRES_V2_BACKEND — non-fatal */
      }
    }
    onExit();
  }, [recordStep, workout, onExit]);

  // Initialize the countdown whenever the step changes. Timed work + all rest
  // steps count down; rep-based work waits for the user's "Done set" tap.
  useEffect(() => {
    if (!step) return;
    indexRef.current = index;
    stepStartRef.current = new Date().toISOString();
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

  // Ring fill = elapsed fraction of a timed/rest countdown; full for rep sets.
  const dur = step.durationSec ?? null;
  const ringPct =
    dur != null && dur > 0 ? ((dur - (secondsLeft ?? dur)) / dur) * 100 : 100;

  return (
    <div className={`player ${step.kind}`}>
      <div className="player-top">
        <button className="link-btn back-link" onClick={finish}>
          <ChevronLeft size={16} /> End
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

          <ProgressRing pct={ringPct} tone={step.durationSec != null ? "accent" : "reps"}>
            {step.durationSec != null ? (
              <div className="timer big">{fmt(secondsLeft ?? step.durationSec)}</div>
            ) : (
              <div className="timer big reps">
                {step.reps}
                <span className="timer-unit">reps</span>
              </div>
            )}
          </ProgressRing>

          {step.notes && <div className="player-notes">{step.notes}</div>}
        </div>
      ) : (
        <div className="player-body">
          <div className="player-phase">REST</div>
          <ProgressRing pct={ringPct} tone="rest">
            <div className="timer big rest">{fmt(secondsLeft ?? step.durationSec)}</div>
          </ProgressRing>
          <div className="player-next">Next: {step.nextExerciseName}</div>
        </div>
      )}

      <div className="player-controls">
        {step.kind === "work" && step.durationSec == null ? (
          <button className="btn primary block" onClick={isLast ? finish : advance}>
            {isLast ? "Finish" : "Done set"}
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => setRunning((r) => !r)}>
              {running ? "Pause" : "Resume"}
            </button>
            <button className="btn" onClick={isLast ? finish : advance}>
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
