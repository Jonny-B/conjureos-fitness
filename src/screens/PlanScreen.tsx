import { useEffect, useState } from "react";
import type { Profile, WeightEntry } from "../types";
import { getRepository } from "../data/repository";
import { todayISO } from "../features/diary";
import { bmi } from "../features/goals";
import { fmtWeight, weightToDisplay, weightToKg, weightUnit } from "../features/units";
import { Sparkline } from "../components/Sparkline";
import { pickWeightKg } from "../components/WeightCard";

/**
 * Plan hub — the home for tracking + coaching, condensing what used to be the
 * separate Trends and Coach tabs. Two sections:
 *   1. Trends: the weight graph + weigh-in + history, with a graceful empty
 *      state that keeps the graph's footprint fixed (no layout jump).
 *   2. Coach session: prefilled starter questions + a free-text box that open
 *      the full Coach chat with the question already submitted.
 */
export function PlanScreen({
  profile,
  onAskCoach,
}: {
  profile: Profile | null;
  onAskCoach: (question: string) => void;
}) {
  return (
    <div className="plan-screen">
      <TrendsPanel profile={profile} />
      <CoachLauncher onAsk={onAskCoach} />
    </div>
  );
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
