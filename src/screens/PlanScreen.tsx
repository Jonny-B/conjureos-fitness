import { useEffect, useState } from "react";
import type { Benchmark, Plan, ProgramWorkout, Profile } from "../types";
import { benchmarkProgress } from "../features/plan/program";
import {
  currentGroup,
  isEvaluationGroup,
  isGroupComplete,
  workoutsInGroup,
} from "../features/plan/groups";
import {
  recordManualBenchmarkEntry,
  startNextGroup,
  toggleWorkoutDone,
  type ManualBenchmarkEntry,
} from "../features/plan/planService";
import { fmtClock, kgToLb, kmToMi, weightToKg, weightUnit } from "../features/units";
import { CheckIcon, PlayIcon } from "../components/icons";
import { useScrollLock } from "../hooks/useScrollLock";
import { WorkoutRunner, metaLine } from "./WorkoutRunner";
import { weekExerciseProgress, type WeekExerciseProgress } from "../features/exercise";

/**
 * Plan hub — the home for the user's plan and coaching, and the owner of the
 * plan's workouts (the Workouts tab is a pure library). Sections:
 *   1. Your plan: benchmarks + plan workouts, each tappable into the runner.
 *   2. This week: training days done against the plan's weekly target.
 *   3. Coach session: prefilled starter questions + a free-text box that open
 *      the full Coach chat with the question already submitted.
 */
export function PlanScreen({
  plan,
  units,
  onPlanChange,
  onAskCoach,
  onEditPlan,
  onEditWorkouts,
  onStartPlan,
  nonce = 0,
}: {
  plan: Plan | null;
  units: Profile["units"];
  onPlanChange: (plan: Plan | null) => void;
  onAskCoach: (question: string) => void;
  /** Edit the whole plan — re-opens the wizard questions (goals, dates, stats). */
  onEditPlan: () => void;
  /** Edit just the workouts/sets — opens the program editor. */
  onEditWorkouts: () => void;
  /** Open the plan wizard — the Plan tab's own entry point when no plan exists. */
  onStartPlan: () => void;
  /** Bumped by the app after any write, so derived views re-read. */
  nonce?: number;
}) {
  // A plan workout mid-run: overview → player → summary → reflect via the runner.
  const [running, setRunning] = useState<ProgramWorkout | null>(null);

  if (running) {
    return (
      <WorkoutRunner
        workout={running.workout}
        programWorkoutId={running.id}
        benchmarkId={running.benchmarkId}
        benchmarkIds={running.benchmarkIds}
        isBenchmark={running.isBenchmark}
        fromPlan
        plan={plan}
        units={units}
        onPlanChange={onPlanChange}
        onExit={() => setRunning(null)}
        onEditWorkouts={onEditWorkouts}
      />
    );
  }

  // ProgramSection carries its own "Your plan / Edit plan" header, but renders
  // nothing without a workout program — so a gated (logging_only) plan needs its
  // own header or there is no way to reach the plan editor at all.
  const showProgram = !!plan?.program;

  return (
    <div className="plan-screen">
      {!plan && <PlanCtaCard onStartPlan={onStartPlan} />}
      {plan && !showProgram && <PlanHeaderSection plan={plan} onEditPlan={onEditPlan} />}
      {plan && showProgram && (
        <ProgramSection
          plan={plan}
          units={units}
          onEditPlan={onEditPlan}
          onEditWorkouts={onEditWorkouts}
          onStart={setRunning}
          onPlanChange={onPlanChange}
        />
      )}
      {plan && (plan.weeklyExerciseDays ?? 0) > 0 && (
        <ExerciseGoalSection target={plan.weeklyExerciseDays!} nonce={nonce} />
      )}
      <CoachLauncher onAsk={onAskCoach} />
    </div>
  );
}

/** The header's one-line subtitle: the plan's end date, if it has one. */
export function headerSubtitle(plan: Plan): string {
  return plan.endDate ? `until ${plan.endDate}` : "";
}

/**
 * The plan's headline + the "Edit plan" entry point, for plans that render no
 * program section (a gated logging_only plan, or one whose program is gone).
 */
function PlanHeaderSection({ plan, onEditPlan }: { plan: Plan; onEditPlan: () => void }) {
  const subtitle = headerSubtitle(plan);
  return (
    <section className="plan-section">
      <div className="section-label">
        Your plan
        <span className="section-actions">
          <button className="link-btn section-action" onClick={onEditPlan}>
            Edit plan
          </button>
        </span>
      </div>
      {plan.goalText && <p className="plan-goal-text">{plan.goalText}</p>}
      {subtitle && <p className="muted small">{subtitle}</p>}
    </section>
  );
}

/**
 * Empty-state entry point shown on the Plan tab when the user has no plan yet —
 * so the tab is a second, obvious way to start one (not a blank screen). Stats
 * already entered are carried into the wizard, so starting here never loses
 * them.
 */
function PlanCtaCard({ onStartPlan }: { onStartPlan: () => void }) {
  return (
    <section className="plan-section">
      <div className="section-label">Your plan</div>
      <div className="summary-card column plan-cta-card">
        <div className="plan-cta-title">Build your plan</div>
        <p className="muted small plan-cta-blurb">
          A personalized plan builds your workouts and benchmarks around your goal. It takes a
          minute, and anything you've already entered is carried straight in.
        </p>
        <button className="btn primary block" onClick={onStartPlan}>
          Build your plan
        </button>
      </div>
    </section>
  );
}

// ── Your plan: benchmarks + plan workouts ──────────────────────────────

function ProgramSection({
  plan,
  units,
  onEditPlan,
  onEditWorkouts,
  onStart,
  onPlanChange,
}: {
  plan: Plan | null;
  units: Profile["units"];
  onEditPlan: () => void;
  onEditWorkouts: () => void;
  onStart: (pw: ProgramWorkout) => void;
  onPlanChange: (plan: Plan | null) => void;
}) {
  const [advancing, setAdvancing] = useState(false);
  // The evaluation workout whose results are being typed in manually, or null.
  const [entryFor, setEntryFor] = useState<ProgramWorkout | null>(null);

  const program = plan?.program;
  if (!plan || !program || program.workouts.length === 0) return null;

  const cur = currentGroup(program);
  const evaluating = isEvaluationGroup(program, cur);
  const groupWorkouts = workoutsInGroup(program, cur);
  const doneCount = groupWorkouts.filter((w) => w.completedAt != null).length;
  const complete = isGroupComplete(program, cur);
  const nextIsEvaluation = isEvaluationGroup(program, cur + 1);

  // Benchmark-first: until every benchmark has a baseline, the training workouts
  // are provisional — the evaluation is what calibrates them. Surface that.
  const needsAssessment = program.benchmarks.some((b) => b.baseline == null);
  // A benchmark card is tappable when its measuring workout is in the CURRENT
  // group and still undone (i.e. tapping it is a sensible next action).
  const toggleDone = async (pw: ProgramWorkout) => {
    onPlanChange(await toggleWorkoutDone(plan, pw.id, pw.completedAt == null));
  };

  const advance = async () => {
    setAdvancing(true);
    try {
      onPlanChange(await startNextGroup(plan));
    } finally {
      setAdvancing(false);
    }
  };

  // ── Benchmark-first gate ─────────────────────────────────────────────
  // Until the benchmark is done, the Plan tab shows ONE thing: a single,
  // clearly-labeled Benchmark card (the old four benchmark cards stacked above
  // workout cards read as seven workouts). Training stays visibly locked —
  // the coach can't calibrate it until the scores exist.
  if (evaluating && needsAssessment && !complete) {
    const evalWorkouts = groupWorkouts.filter((w) => w.isBenchmark);
    const nextEval = evalWorkouts.find((w) => w.completedAt == null) ?? evalWorkouts[0];
    return (
      <section className="plan-section program-section">
        <div className="section-label">
          Your plan
          <span className="section-actions">
            <button className="link-btn section-action" onClick={onEditPlan}>
              Edit plan
            </button>
            {plan?.program && (
              <button className="link-btn section-action" onClick={onEditWorkouts}>
                Edit workouts
              </button>
            )}
          </span>
        </div>

        <div className="benchmark-hero">
          <div className="benchmark-hero-head">
            <span className="benchmark-badge">Benchmark</span>
            <h3 className="benchmark-hero-title">First, measure where you are</h3>
          </div>
          <p className="muted small benchmark-hero-blurb">
            One test session — it sets your starting numbers so your coach can size every
            training workout to you. Not a workout to beat, just an honest measurement.
          </p>
          <ul className="benchmark-hero-rows">
            {program.benchmarks.map((b) => (
              <li key={b.id}>
                <span className="bh-name">{b.name}</span>
                <span className="muted small">
                  goal {b.lowerIsBetter ? "≤ " : ""}
                  {formatBenchmarkValue(b.target, b, units)}
                </span>
              </li>
            ))}
          </ul>
          {nextEval && (
            <>
              <button className="btn primary block" onClick={() => onStart(nextEval)}>
                Start the benchmark
              </button>
              <button className="link-btn benchmark-hero-manual" onClick={() => setEntryFor(nextEval)}>
                Know your numbers? Enter them instead
              </button>
            </>
          )}
        </div>

        <div className="muted small program-locked">
          Your training workouts unlock once the benchmark is done — the coach adjusts them to
          your scores.
        </div>

        {entryFor && (
          <EvalEntrySheet
            plan={plan}
            programWorkout={entryFor}
            units={units}
            onClose={() => setEntryFor(null)}
            onSaved={(next) => {
              setEntryFor(null);
              onPlanChange(next);
            }}
          />
        )}
      </section>
    );
  }

  return (
    <section className="plan-section program-section">
      <div className="section-label">
        Your workouts
        <span className={`group-chip${evaluating ? " eval" : ""}`}>
          {evaluating ? "Evaluation" : `Group ${cur}`}
        </span>
        <span className="section-actions">
          <button className="link-btn section-action" onClick={onEditPlan}>
            Edit plan
          </button>
          <button className="link-btn section-action" onClick={onEditWorkouts}>
            Edit workouts
          </button>
        </span>
      </div>

      <div className="mini-label muted small">This group's workouts</div>
      <ul className="workout-list">
        {groupWorkouts.map((pw) => {
          const done = pw.completedAt != null;
          // A non-evaluation workout is "provisional" until the baselines exist.
          const provisional = needsAssessment && !pw.isBenchmark;
          return (
            <li key={pw.id} className="workout-row">
              <button
                className={`workout-check${done ? " done" : ""}`}
                aria-label={done ? `Mark ${pw.workout.name} not done` : `Mark ${pw.workout.name} done`}
                onClick={() => void toggleDone(pw)}
              >
                {done && <CheckIcon size={16} />}
              </button>
              <div className="workout-row-main">
                <button className={`workout-card${done ? " done" : ""}`} onClick={() => onStart(pw)}>
                  <div className="workout-card-text">
                    <div className="workout-name">
                      {pw.workout.name}
                      {pw.isBenchmark && <span className="benchmark-badge">Evaluation</span>}
                    </div>
                    {pw.workout.summary && <div className="workout-summary">{pw.workout.summary}</div>}
                    <div className="workout-meta">
                      {metaLine(pw.workout)}
                      {provisional && <span className="provisional-tag"> · provisional</span>}
                    </div>
                  </div>
                  <span className="workout-play" aria-hidden>
                    <PlayIcon size={18} />
                  </span>
                </button>
                {pw.isBenchmark && !done && (
                  <button className="link-btn workout-manual-entry" onClick={() => setEntryFor(pw)}>
                    Know your numbers? Enter results instead
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="group-progress muted small">
        {doneCount} of {groupWorkouts.length} done
        {complete ? " — nice work." : ""}
      </div>

      {complete && (
        <button className="btn primary block" disabled={advancing} onClick={() => void advance()}>
          {advancing
            ? "Building your next workouts…"
            : nextIsEvaluation
              ? "Start your next evaluation"
              : "Start your next group"}
        </button>
      )}

      {/* Progress: benchmarks are what the plan is measured by — reference, not
          tasks. Read-only, below the actionable workouts. */}
      {program.benchmarks.length > 0 && (
        <div className="progress-strip">
          <div className="mini-label muted small">Your progress</div>
          {program.benchmarks.map((b) => (
            <BenchmarkCard key={b.id} benchmark={b} units={units} />
          ))}
        </div>
      )}

      {entryFor && (
        <EvalEntrySheet
          plan={plan}
          programWorkout={entryFor}
          units={units}
          onClose={() => setEntryFor(null)}
          onSaved={(next) => {
            setEntryFor(null);
            onPlanChange(next);
          }}
        />
      )}
    </section>
  );
}

// ── Manual evaluation entry ────────────────────────────────────────────

/** Convert a display-units entry to the benchmark's storage value. */
function toStorageValue(b: Benchmark, shown: number, units: Profile["units"]): number {
  if (b.metric === "weightKg") return weightToKg(shown, units);
  if (b.metric === "distanceKm" && units === "imperial") return shown * 1.609344;
  return shown;
}

/** What the input's unit label should read for a benchmark, per display units. */
function entryUnitLabel(b: Benchmark, units: Profile["units"]): string {
  if (b.metric === "weightKg") return weightUnit(units);
  if (b.metric === "distanceKm") return units === "imperial" ? "mi" : "km";
  return b.unit;
}

/**
 * "I already know my numbers" — a sheet that records evaluation results without
 * running the workout. One row per benchmark the evaluation measures (time
 * entries split into min + sec); saving routes through the same fold-in +
 * calibration path a performed evaluation takes and checks the workout off.
 */
function EvalEntrySheet({
  plan,
  programWorkout,
  units,
  onClose,
  onSaved,
}: {
  plan: Plan;
  programWorkout: ProgramWorkout;
  units: Profile["units"];
  onClose: () => void;
  onSaved: (plan: Plan | null) => void;
}) {
  useScrollLock();
  const program = plan.program!;
  const ids = new Set(programWorkout.benchmarkIds ?? (programWorkout.benchmarkId ? [programWorkout.benchmarkId] : []));
  const benchmarks = program.benchmarks.filter((b) => ids.size === 0 || ids.has(b.id));
  // Raw strings per benchmark id; duration benchmarks get ":min" and ":sec" keys.
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const numOf = (key: string): number => {
    const n = Number((raw[key] ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const entries = (): ManualBenchmarkEntry[] =>
    benchmarks
      .map((b) => {
        const value =
          b.metric === "durationSec"
            ? numOf(`${b.id}:min`) * 60 + numOf(`${b.id}:sec`)
            : toStorageValue(b, numOf(b.id), units);
        return { benchmarkId: b.id, value };
      })
      .filter((e) => e.value > 0);

  const canSave = entries().length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const next = await recordManualBenchmarkEntry(plan, programWorkout.id, entries());
      onSaved(next);
    } catch {
      /* the save failed and the user was told; keep the sheet open to retry */
    } finally {
      setBusy(false);
    }
  };

  const setKey = (key: string, v: string) => {
    if (v === "" || /^\d*\.?\d*$/.test(v)) setRaw((prev) => ({ ...prev, [key]: v }));
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet entry-edit" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Enter your results</h2>
          <button className="link-btn" onClick={onClose}>
            Cancel
          </button>
        </header>

        <div className="sheet-body">
          <p className="muted small">
            Already know where you stand? Enter your numbers and your workouts calibrate to them —
            same as doing the evaluation. Leave anything you're unsure of blank.
          </p>
          {benchmarks.map((b) => (
            <div className="field" key={b.id}>
              <span>{b.name}</span>
              {b.metric === "durationSec" ? (
                <div className="row gap eval-entry-duration">
                  <input
                    className="text-input"
                    inputMode="numeric"
                    type="text"
                    placeholder="min"
                    aria-label={`${b.name} minutes`}
                    value={raw[`${b.id}:min`] ?? ""}
                    onChange={(e) => setKey(`${b.id}:min`, e.target.value)}
                  />
                  <input
                    className="text-input"
                    inputMode="numeric"
                    type="text"
                    placeholder="sec"
                    aria-label={`${b.name} seconds`}
                    value={raw[`${b.id}:sec`] ?? ""}
                    onChange={(e) => setKey(`${b.id}:sec`, e.target.value)}
                  />
                </div>
              ) : (
                <div className="row gap eval-entry-value">
                  <input
                    className="text-input"
                    inputMode="decimal"
                    type="text"
                    placeholder="0"
                    aria-label={b.name}
                    value={raw[b.id] ?? ""}
                    onChange={(e) => setKey(b.id, e.target.value)}
                  />
                  <span className="muted small eval-entry-unit">{entryUnitLabel(b, units)}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <footer className="sheet-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canSave} onClick={() => void save()}>
            {busy ? "Saving…" : "Save results"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * A single benchmark as a compact, READ-ONLY progress row: name + target, then a
 * baseline→target bar with the current value (or "Not measured yet"). Benchmarks
 * are what the plan is measured by — they are never tapped to launch a workout
 * (the Evaluation workout in the list does the measuring), so this is not a
 * button and carries no play affordance.
 */
function BenchmarkCard({ benchmark: b, units }: { benchmark: Benchmark; units: Profile["units"] }) {
  const pct = benchmarkProgress(b);
  const latest = b.history.length ? b.history[b.history.length - 1]!.value : null;
  const fmt = (v: number) => formatBenchmarkValue(v, b, units);

  return (
    <div className="progress-row">
      <div className="progress-row-head">
        <span className="progress-name">{b.name}</span>
        <span className="progress-target muted small">
          {b.lowerIsBetter ? "target ≤ " : "target "}
          {fmt(b.target)}
        </span>
      </div>
      {b.baseline == null ? (
        <div className="muted small">Not measured yet</div>
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
  if (b.metric === "durationSec") return v >= 60 ? fmtClock(v) : `${Math.round(v)}s`;
  if (b.metric === "weightKg" && units === "imperial") return `${Math.round(kgToLb(v))} lb`;
  if (b.metric === "distanceKm" && units === "imperial") return `${kmToMi(v).toFixed(2)} mi`;
  return `${Math.round(v * 10) / 10} ${b.unit}`;
}

/**
 * Weekly training goal: how many days this week the user recorded any
 * exercise, against their plan's target days. Read-only — it counts the same
 * workouts the Workouts tab lists for each day.
 */
function ExerciseGoalSection({ target, nonce = 0 }: { target: number; nonce?: number }) {
  const [prog, setProg] = useState<WeekExerciseProgress | null>(null);

  useEffect(() => {
    let alive = true;
    weekExerciseProgress(target)
      .then((r) => alive && setProg(r))
      .catch(() => alive && setProg(null));
    return () => {
      alive = false;
    };
  }, [target, nonce]);

  const done = prog?.days ?? 0;
  const hit = done >= target;
  return (
    <section className="plan-section">
      <div className="section-label">Movement</div>
      <div className="summary-card column">
        <div className="exercise-goal-head">
          <strong>
            {done} of {target}
          </strong>{" "}
          <span className="muted">days this week</span>
          {hit && <span className="exercise-goal-hit">✓ goal met</span>}
        </div>
        <div className="exercise-goal-dots" aria-hidden>
          {(prog?.weekDates ?? []).map((d) => (
            <span
              key={d}
              className={`exercise-dot${prog?.activeDates.includes(d) ? " on" : ""}`}
              title={d}
            />
          ))}
        </div>
        <p className="muted small">
          Counts any day with exercise — logged here or synced from Apple Health.
        </p>
      </div>
    </section>
  );
}

// ── Coach session launcher ─────────────────────────────────────────────

const STARTERS = [
  "How am I doing this week?",
  "What should I focus on tomorrow?",
  "This plan feels too hard",
  "Should I train or rest today?",
];

export function CoachLauncher({ onAsk }: { onAsk: (question: string) => void }) {
  const [text, setText] = useState("");
  const ask = (q: string) => {
    const t = q.trim();
    if (t) onAsk(t);
  };

  return (
    <section className="plan-section coach-launch">
      <div className="section-label">Talk to your coach</div>
      <p className="muted small coach-launch-hint">
        Start with a question below or ask your own — it opens a full chat with your coach, who can
        see your plan and workouts.
      </p>
      <div className="coach-launch-chips">
        {STARTERS.map((s) => (
          <button key={s} className="chip" onClick={() => ask(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="row gap coach-launch-compose">
        <textarea
          className="text-input"
          rows={1}
          value={text}
          placeholder="Ask your coach anything…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(text);
            }
          }}
        />
        <button className="btn primary" disabled={!text.trim()} onClick={() => ask(text)}>
          Ask
        </button>
      </div>
    </section>
  );
}
