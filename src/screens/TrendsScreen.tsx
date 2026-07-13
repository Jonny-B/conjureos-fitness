import { useEffect, useState } from "react";
import type { Profile, WeightEntry } from "../types";
import { getRepository } from "../data/repository";
import { todayISO } from "../features/diary";
import { bmi } from "../features/goals";
import { fmtWeight, weightToDisplay, weightToKg, weightUnit } from "../features/units";

/**
 * Weight tracking + trend. A functional slice (reads/writes through the
 * repository) with a lightweight SVG sparkline. Body-composition trends,
 * goal-weight projection, and exercise/calories-burned history are the
 * obvious next additions here.
 */
export function TrendsScreen({ profile }: { profile: Profile | null }) {
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [input, setInput] = useState("");

  const reload = async () => {
    const repo = await getRepository();
    setWeights(await repo.listWeights());
  };
  useEffect(() => {
    reload();
  }, []);

  // Display in the user's units; storage stays metric (WU).
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

  const latest = weights[0];
  const oldest = weights[weights.length - 1];
  const changeKg = latest && oldest && weights.length > 1 ? latest.weightKg - oldest.weightKg : 0;
  const changeDisplay =
    units === "imperial"
      ? Math.round((changeKg * 2.2046226218) * 10) / 10
      : Math.round(changeKg * 10) / 10;

  return (
    <div className="trends">
      <h1 className="screen-title">Weight</h1>

      <section className="summary-card column">
        <div className="big-stat">
          <span className="big-number">{latest ? weightToDisplay(latest.weightKg, units) : "—"}</span>
          <span className="big-unit">{weightUnit(units)}</span>
        </div>
        <div className="stat-row">
          {weights.length > 1 && (
            <span className={changeKg <= 0 ? "good" : "bad"}>
              {changeKg > 0 ? "+" : ""}
              {changeDisplay} {weightUnit(units)} overall
            </span>
          )}
          {profile && <span className="muted">BMI {bmi({ ...profile, weightKg: latest?.weightKg ?? profile.weightKg })}</span>}
        </div>
        <Sparkline points={[...weights].reverse().map((w) => w.weightKg)} />
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

      <ul className="weight-list">
        {weights.map((w) => (
          <li key={w.date} className="weight-row">
            <span>{w.date}</span>
            <span>{fmtWeight(w.weightKg, units)}</span>
          </li>
        ))}
        {weights.length === 0 && <li className="muted small">No weigh-ins yet.</li>}
      </ul>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="sparkline-empty muted small">Log a few days to see your trend.</div>;
  const W = 280;
  const H = 64;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => ({
    x: (i / (points.length - 1)) * W,
    y: H - ((p - min) / span) * (H - 10) - 5,
  }));
  const line = xy.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
  // Close the path down to the baseline so we can fill the area under the line.
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    // preserveAspectRatio="none" stretches the path to fill the container width;
    // we deliberately use no point markers here since a <circle> would distort.
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cui-accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--cui-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} className="sparkline-area" />
      <path d={line} className="sparkline-path" />
    </svg>
  );
}
