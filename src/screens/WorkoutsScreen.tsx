import { useCallback, useEffect, useRef, useState } from "react";
import type { Benchmark, ExerciseActual, Plan, Profile, Workout, WorkoutSession } from "../types";
import { BUILT_IN_WORKOUTS, buildSteps, newCardioSession, newSessionFrom, type PlayerStep } from "../features/workouts";
import { normalizeExerciseKey } from "../features/explainers/normalizeKey";
import { benchmarkProgress, recordBenchmarkResult } from "../features/plan/program";
import { lastSetFor } from "../features/workoutHistory";
import { getRepository } from "../data/repository";
import { ProgressRing } from "../components/rings";
import { SetRecorder, type SetEntry } from "../components/SetRecorder";
import { ExplainerDropdown } from "../components/ExplainerDropdown";
import { CardioPlayer } from "./CardioPlayer";
import { WorkoutSummary } from "./WorkoutSummary";
import { ChevronLeft, PlayIcon } from "../components/icons";

type View =
  | { screen: "list" }
  | { screen: "player"; workout: Workout; benchmarkId?: string }
  | { screen: "cardio"; workout: Workout; benchmarkId?: string }
  | { screen: "summary"; workout: Workout; byExercise: ExerciseActual[]; benchmarkId?: string };

const isCardio = (w: Workout) => w.kind === "run" || w.kind === "bike";
const setCount = (w: Workout) => w.exercises.reduce((s, e) => s + e.sets.length, 0);

function metaLine(w: Workout): string {
  if (isCardio(w)) return w.kind === "run" ? "Run · track distance" : "Bike · track distance";
  return `${w.exercises.length} exercises · ${setCount(w)} sets`;
}

export function WorkoutsScreen({ units }: { units: Profile["units"] }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    let alive = true;
    getRepository()
      .then((r) => r.getPlan())
      .then((p) => alive && setPlan(p))
      .catch(() => {
        /* Supabase throws PLAN_REQUIRES_V2_BACKEND — no program to show */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Persist a finished session, then fold any benchmark result back into the
  // plan's program and save it (the adaptive loop's measurement half).
  const saveSession = useCallback(
    async (session: WorkoutSession) => {
      try {
        const repo = await getRepository();
        await repo.saveWorkoutSession(session);
        if (plan?.program && session.benchmarkId) {
          const program = recordBenchmarkResult(plan.program, session);
          if (program !== plan.program) {
            const updated = { ...plan, program };
            await repo.savePlan(updated);
            setPlan(updated);
          }
        }
      } catch {
        /* mock persists; Supabase throws — non-fatal */
      }
    },
    [plan],
  );

  if (view.screen === "cardio") {
    return (
      <CardioPlayer
        workout={view.workout}
        units={units}
        onFinish={async (cardio) => {
          await saveSession(newCardioSession(view.workout, cardio, view.benchmarkId));
          setView({ screen: "list" });
        }}
        onCancel={() => setView({ screen: "list" })}
      />
    );
  }

  if (view.screen === "player") {
    return (
      <StrengthPlayer
        workout={view.workout}
        onFinish={(byExercise) =>
          setView({ screen: "summary", workout: view.workout, byExercise, benchmarkId: view.benchmarkId })
        }
        onCancel={() => setView({ screen: "list" })}
      />
    );
  }

  if (view.screen === "summary") {
    return (
      <WorkoutSummary
        workout={view.workout}
        byExercise={view.byExercise}
        onSave={async () => {
          await saveSession(newSessionFrom(view.workout, view.byExercise, view.benchmarkId));
          setView({ screen: "list" });
        }}
        onDiscard={() => setView({ screen: "list" })}
      />
    );
  }

  const start = (workout: Workout, benchmarkId?: string) =>
    setView({ screen: isCardio(workout) ? "cardio" : "player", workout, benchmarkId });

  const program = plan?.program;

  return (
    <div className="workouts">
      <h1 className="screen-title">Workouts</h1>

      {program && program.workouts.length > 0 && (
        <section className="program-section">
          <div className="section-label">Your plan</div>
          {program.benchmarks.map((b) => (
            <BenchmarkCard key={b.id} benchmark={b} units={units} />
          ))}
          <ul className="workout-list">
            {program.workouts.map((pw) => (
              <li key={pw.id}>
                <button className="workout-card" onClick={() => start(pw.workout, pw.benchmarkId)}>
                  <div className="workout-card-text">
                    <div className="workout-name">
                      {pw.workout.name}
                      {pw.isBenchmark && <span className="benchmark-badge">Benchmark</span>}
                    </div>
                    {pw.workout.summary && <div className="workout-summary">{pw.workout.summary}</div>}
                    <div className="workout-meta">{metaLine(pw.workout)}</div>
                  </div>
                  <span className="workout-play" aria-hidden>
                    <PlayIcon size={18} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="section-label">{program ? "Library" : ""}</div>
      <ul className="workout-list">
        {BUILT_IN_WORKOUTS.map((w) => (
          <li key={w.id}>
            <button className="workout-card" onClick={() => start(w)}>
              <div className="workout-card-text">
                <div className="workout-name">{w.name}</div>
                <div className="workout-summary">{w.summary}</div>
                <div className="workout-meta">{metaLine(w)}</div>
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

/** Benchmark baseline → target progress card, shown atop a plan's program. */
function BenchmarkCard({ benchmark: b, units }: { benchmark: Benchmark; units: Profile["units"] }) {
  const pct = benchmarkProgress(b);
  const latest = b.history.length ? b.history[b.history.length - 1]!.value : null;
  const fmt = (v: number) => formatBenchmarkValue(v, b, units);
  return (
    <div className="benchmark-card">
      <div className="benchmark-head">
        <span className="benchmark-name">{b.name}</span>
        <span className="benchmark-target">
          {b.lowerIsBetter ? "target ≤ " : "target "}
          {fmt(b.target)}
        </span>
      </div>
      {b.baseline == null ? (
        <div className="muted small">Complete the benchmark workout to set your baseline.</div>
      ) : (
        <>
          <div className="benchmark-track">
            <div className="benchmark-fill" style={{ width: `${Math.round((pct ?? 0) * 100)}%` }} />
          </div>
          <div className="benchmark-row">
            <span className="muted small">start {fmt(b.baseline)}</span>
            {latest != null && <span className="benchmark-now">now {fmt(latest)}</span>}
          </div>
        </>
      )}
    </div>
  );
}

/** Format a benchmark value with its unit; weight/distance respect display units. */
function formatBenchmarkValue(v: number, b: Benchmark, units: Profile["units"]): string {
  if (b.metric === "durationSec") {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
  }
  if (b.metric === "weightKg" && units === "imperial") return `${Math.round(v * 2.2046226218)} lb`;
  if (b.metric === "distanceKm" && units === "imperial") return `${(v * 0.621371).toFixed(2)} mi`;
  return `${Math.round(v * 10) / 10} ${b.unit}`;
}

// ── Guided strength player: timers, rest, per-set recording ──────────────

interface ActualBucket extends ExerciseActual {
  order: number;
}

function StrengthPlayer({
  workout,
  onFinish,
  onCancel,
}: {
  workout: Workout;
  onFinish: (byExercise: ExerciseActual[]) => void;
  onCancel: () => void;
}) {
  const stepsRef = useRef<PlayerStep[]>(buildSteps(workout));
  const steps = stepsRef.current;

  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [running, setRunning] = useState(true);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [entry, setEntry] = useState<SetEntry>({});
  const step = steps[index];

  const beep = useBeep();

  const actualsRef = useRef<Map<string, ActualBucket>>(new Map());
  const recordedRef = useRef<Set<number>>(new Set());
  const stepStartRef = useRef<string>(new Date().toISOString());
  const indexRef = useRef(0);
  const entryRef = useRef<SetEntry>({});
  useEffect(() => {
    entryRef.current = entry;
  }, [entry]);

  // Load prior sessions once, for "last time" + overload suggestions.
  useEffect(() => {
    let alive = true;
    getRepository()
      .then((r) => r.listWorkoutSessions(200))
      .then((s) => alive && setSessions(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const isRepStep = (s: PlayerStep | undefined): s is Extract<PlayerStep, { kind: "work" }> =>
    s?.kind === "work" && s.durationSec == null;

  // Record the currently-active work step from the entered values (rep/weighted)
  // or the prescribed duration (timed). Idempotent per step index.
  const recordCurrent = useCallback(() => {
    const i = indexRef.current;
    const s = steps[i];
    if (!s || s.kind !== "work" || recordedRef.current.has(i)) return;
    recordedRef.current.add(i);
    const key = normalizeExerciseKey(s.exerciseName);
    const bucket =
      actualsRef.current.get(key) ??
      { exerciseKey: key, name: s.exerciseName, sets: [], order: s.exerciseIndex };
    const timed = s.durationSec != null;
    const e = entryRef.current;
    bucket.sets.push({
      reps: timed ? undefined : e.reps ?? s.reps ?? undefined,
      weightKg: timed ? undefined : e.weightKg ?? s.weightKg,
      durationSec: timed ? s.durationSec ?? undefined : undefined,
      rpe: e.rpe,
      startedAt: stepStartRef.current,
      completedAt: new Date().toISOString(),
    });
    actualsRef.current.set(key, bucket);
  }, [steps]);

  const buildByExercise = (): ExerciseActual[] =>
    [...actualsRef.current.values()]
      .sort((a, b) => a.order - b.order)
      .map((e) => ({ exerciseKey: e.exerciseKey, name: e.name, sets: e.sets }));

  const advance = useCallback(() => {
    recordCurrent();
    setIndex((i) => {
      const next = i + 1;
      return next >= steps.length ? i : next;
    });
  }, [recordCurrent, steps.length]);

  const finish = useCallback(() => {
    recordCurrent();
    const by = buildByExercise();
    if (by.length === 0) onCancel();
    else onFinish(by);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordCurrent, onCancel, onFinish]);

  // Initialize each step: countdown for timed/rest, prefill the recorder for
  // rep sets from the prescription then last time.
  useEffect(() => {
    if (!step) return;
    indexRef.current = index;
    stepStartRef.current = new Date().toISOString();
    if (step.kind === "rest") setSecondsLeft(step.durationSec);
    else if (step.durationSec != null) setSecondsLeft(step.durationSec);
    else setSecondsLeft(null);
    setRunning(true);
    if (isRepStep(step)) {
      const last = lastSetFor(sessions, normalizeExerciseKey(step.exerciseName));
      setEntry({
        reps: step.reps ?? last?.reps ?? undefined,
        weightKg: step.weightKg ?? last?.weightKg ?? undefined,
      });
    } else {
      setEntry({});
    }
  }, [index, step, sessions]);

  // 1 Hz countdown tick for timed work + rest.
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
  const dur = step.durationSec ?? null;
  const ringPct = dur != null && dur > 0 ? ((dur - (secondsLeft ?? dur)) / dur) * 100 : 100;

  const frameTone = step.kind === "rest" ? "rest" : isRepStep(step) ? "reps" : "timed";

  return (
    <div className={`player ${step.kind} ${frameTone}`}>
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
          </div>

          {step.durationSec != null ? (
            <ProgressRing pct={ringPct} tone="accent">
              <div className="timer big">{fmt(secondsLeft ?? step.durationSec)}</div>
            </ProgressRing>
          ) : (
            <SetRecorder
              prescribed={{ reps: step.reps, weightKg: step.weightKg, durationSec: step.durationSec }}
              last={lastSetFor(sessions, normalizeExerciseKey(step.exerciseName))}
              value={entry}
              onChange={setEntry}
            />
          )}

          {step.notes && <div className="player-notes">{step.notes}</div>}
          <ExplainerDropdown name={step.exerciseName} />
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
        {isRepStep(step) ? (
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
