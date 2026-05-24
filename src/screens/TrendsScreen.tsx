import { useEffect, useState } from "react";
import type { Profile, WeightEntry } from "../types";
import { getRepository } from "../data/repository";
import { todayISO } from "../features/diary";
import { bmi } from "../features/goals";

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

  const add = async () => {
    const kg = Number(input);
    if (!Number.isFinite(kg) || kg <= 0) return;
    const repo = await getRepository();
    await repo.upsertWeight({ date: todayISO(), weightKg: Math.round(kg * 10) / 10 });
    setInput("");
    await reload();
  };

  const latest = weights[0];
  const oldest = weights[weights.length - 1];
  const change = latest && oldest && weights.length > 1 ? latest.weightKg - oldest.weightKg : 0;

  return (
    <div className="trends">
      <h1 className="screen-title">Weight</h1>

      <section className="summary-card column">
        <div className="big-stat">
          <span className="big-number">{latest ? latest.weightKg : "—"}</span>
          <span className="big-unit">kg</span>
        </div>
        <div className="stat-row">
          {weights.length > 1 && (
            <span className={change <= 0 ? "good" : "bad"}>
              {change > 0 ? "+" : ""}
              {Math.round(change * 10) / 10} kg overall
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
          placeholder="Today's weight (kg)"
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
            <span>{w.weightKg} kg</span>
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
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - ((p - min) / span) * (H - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={path} className="sparkline-path" />
    </svg>
  );
}
