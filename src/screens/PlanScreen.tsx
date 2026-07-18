import { useEffect, useState } from "react";
import type { Benchmark, Plan, Profile, WeightEntry, Workout } from "../types";
import { getRepository } from "../data/repository";
import { todayISO } from "../features/diary";
import { bmi } from "../features/goals";
import { benchmarkProgress } from "../features/plan/program";
import { fmtWeight, weightToDisplay, weightToKg, weightUnit } from "../features/units";
import { Sparkline } from "../components/Sparkline";
import { pickWeightKg } from "../components/WeightCard";
import { PlayIcon } from "../components/icons";
import { WorkoutRunner, metaLine } from "./WorkoutRunner";

/**
 * Plan hub — the home for the user's plan, tracking + coaching, condensing what
 * used to be the separate Trends and Coach tabs and now also owning the plan's
 * workouts (moved off the Workouts tab, which is a pure library). Sections:
 *   1. Your plan: benchmarks + plan workouts, each tappable into the runner.
 *   2. Trends: the weight graph + weigh-in + history, with a graceful empty
 *      state that keeps the graph's footprint fixed (no layout jump).
 *   3. Coach session: prefilled starter questions + a free-text box that open
 *      the full Coach chat with the question already submitted.
 */
export function PlanScreen({
  profile,
  plan,
  units,
  onPlanChange,
  onAskCoach,
  onEditPlan,
}: {
  profile: Profile | null;
  plan: Plan | null;
  units: Profile["units"];
  onPlanChange: (plan: Plan | null) => void;
  onAskCoach: (question: string) => void;
  onEditPlan: () => void;
}) {
  // A plan workout mid-run: overview → player → summary → reflect via the runner.
  const [running, setRunning] = useState<{ workout: Workout; benchmarkId?: string; isBenchmark?: boolean } | null>(
    null,
  );

  if (running) {
    return (
      <WorkoutRunner
        workout={running.workout}
        benchmarkId={running.benchmarkId}
        isBenchmark={running.isBenchmark}
        fromPlan
        plan={plan}
        units={units}
        onPlanChange={onPlanChange}
        onExit={() => setRunning(null)}
        onEditPlan={onEditPlan}
      />
    );
  }

  return (
    <div className="plan-screen">
      <ProgramSection
        plan={plan}
        units={units}
        onEditPlan={onEditPlan}
        onStart={(workout, benchmarkId, isBenchmark) => setRunning({ workout, benchmarkId, isBenchmark })}
      />
      <TrendsPanel profile={profile} />
      <CoachLauncher onAsk={onAskCoach} />
    </div>
  );
}

// ── Your plan: benchmarks + plan workouts ──────────────────────────────

function ProgramSection({
  plan,
  units,
  onEditPlan,
  onStart,
}: {
  plan: Plan | null;
  units: Profile["units"];
  onEditPlan: () => void;
  onStart: (workout: Workout, benchmarkId?: string, isBenchmark?: boolean) => void;
}) {
  const program = plan?.program;
  if (!program || program.workouts.length === 0) return null;

  return (
    <section className="plan-section program-section">
      <div className="section-label">
        Your workouts
        <button className="link-btn section-action" onClick={onEditPlan}>
          Edit plan
        </button>
      </div>
      {program.benchmarks.map((b) => {
        // The benchmark card is measured by one of the plan's workouts; make the
        // card open that workout so every card in the list is tappable (a
        // benchmark with no measuring workout stays a display).
        const pw = program.workouts.find((w) => w.benchmarkId === b.id);
        return (
          <BenchmarkCard
            key={b.id}
            benchmark={b}
            units={units}
            onStart={pw ? () => onStart(pw.workout, pw.benchmarkId, pw.isBenchmark) : undefined}
          />
        );
      })}
      <ul className="workout-list">
        {program.workouts.map((pw) => (
          <li key={pw.id}>
            <button className="workout-card" onClick={() => onStart(pw.workout, pw.benchmarkId, pw.isBenchmark)}>
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
  );
}

/**
 * Benchmark baseline → target progress card, shown atop a plan's program.
 * When `onStart` is given (a plan workout measures this benchmark), the whole
 * card is a button that opens that workout — so in the plan list every card is
 * tappable, not just the workout rows.
 */
function BenchmarkCard({
  benchmark: b,
  units,
  onStart,
}: {
  benchmark: Benchmark;
  units: Profile["units"];
  onStart?: () => void;
}) {
  const pct = benchmarkProgress(b);
  const latest = b.history.length ? b.history[b.history.length - 1]!.value : null;
  const fmt = (v: number) => formatBenchmarkValue(v, b, units);

  const body = (
    <div className="benchmark-card-main">
      <div className="benchmark-head">
        <span className="benchmark-name">{b.name}</span>
        <span className="benchmark-target">
          {b.lowerIsBetter ? "target ≤ " : "target "}
          {fmt(b.target)}
        </span>
      </div>
      {b.baseline == null ? (
        <div className="muted small">
          {onStart ? "Tap to do the benchmark and set your baseline." : "Complete the benchmark workout to set your baseline."}
        </div>
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

  if (!onStart) return <div className="benchmark-card">{body}</div>;
  return (
    <button className="benchmark-card tappable" onClick={onStart}>
      {body}
      <span className="workout-play" aria-hidden>
        <PlayIcon size={18} />
      </span>
    </button>
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

// ── Trends ─────────────────────────────────────────────────────────────

function TrendsPanel({ profile }: { profile: Profile | null }) {
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [input, setInput] = useState("");

  const reload = async () => {
    const repo = await getRepository();
    setWeights(await repo.listWeights());
  };
  useEffect(() => {
    reload();
  }, []);

  const units = profile?.units ?? "metric";

  const add = async () => {
    const shown = Number(input);
    if (!Number.isFinite(shown) || shown <= 0) return;
    const kg = weightToKg(shown, units);
    const repo = await getRepository();
    await repo.upsertWeight({ date: todayISO(), weightKg: Math.round(kg * 10) / 10 });
    setInput("");
    await reload();
  };

  // Graceful "last known weight": newest weigh-in, else the plan/profile weight;
  // only truly empty when neither exists (then a prompt, never a bare dash).
  const { kg: latestKg, fromProfile } = pickWeightKg(weights, profile);
  const oldest = weights[weights.length - 1];
  const latest = weights[0];
  const changeKg = latest && oldest && weights.length > 1 ? latest.weightKg - oldest.weightKg : 0;
  const changeDisplay =
    units === "imperial" ? Math.round(changeKg * 2.2046226218 * 10) / 10 : Math.round(changeKg * 10) / 10;

  return (
    <section className="plan-section">
      <div className="section-label">Trends</div>
      {/* Fixed min-height so the card's footprint stays constant whether it's
          empty, a single weigh-in, or a full trend. */}
      <section className="summary-card column trends-card">
        {latestKg != null ? (
          <>
            <div className="big-stat">
              <span className="big-number">{weightToDisplay(latestKg, units)}</span>
              <span className="big-unit">{weightUnit(units)}</span>
            </div>
            <div className="stat-row">
              {weights.length > 1 ? (
                <span className={changeKg <= 0 ? "good" : "bad"}>
                  {changeKg > 0 ? "+" : ""}
                  {changeDisplay} {weightUnit(units)} overall
                </span>
              ) : fromProfile ? (
                <span className="muted small">from your plan</span>
              ) : null}
              {profile && (
                <span className="muted">
                  BMI {bmi({ ...profile, weightKg: latest?.weightKg ?? profile.weightKg })}
                </span>
              )}
            </div>
            <Sparkline points={[...weights].reverse().map((w) => w.weightKg)} />
          </>
        ) : (
          <div className="trends-empty muted">Log your first weigh-in to start tracking your trend.</div>
        )}
      </section>

      <div className="row gap weigh-in">
        <input
          className="text-input"
          type="number"
          inputMode="decimal"
          placeholder={`Today's weight (${weightUnit(units)})`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn primary" disabled={!input} onClick={add}>
          Log
        </button>
      </div>

      {weights.length > 0 && (
        <ul className="weight-list">
          {weights.map((w) => (
            <li key={w.date} className="weight-row">
              <span>{w.date}</span>
              <span>{fmtWeight(w.weightKg, units)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Coach session launcher ─────────────────────────────────────────────

const STARTERS = [
  "How am I doing this week?",
  "What should I focus on tomorrow?",
  "This plan feels too hard",
  "What should I eat before a workout?",
];

function CoachLauncher({ onAsk }: { onAsk: (question: string) => void }) {
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
        see your plan, food, weight, and workouts.
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
