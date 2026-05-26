import type { DayTotals, Goals } from "../lib/types";

interface Props {
  totals: DayTotals;
  goals: Goals;
  onEditGoals: () => void;
}

/** The day's headline: a calorie ring + the three macro bars. */
export default function DaySummary({ totals, goals, onEditGoals }: Props) {
  const remaining = goals.calories - totals.net;
  const pct = goals.calories > 0 ? Math.min(1, Math.max(0, totals.net / goals.calories)) : 0;
  const over = totals.net > goals.calories;

  // Ring geometry
  const r = 78;
  const c = 2 * Math.PI * r;

  return (
    <section className="summary card">
      <div className="ring-wrap">
        <svg viewBox="0 0 180 180" className="ring" role="img"
             aria-label={`${totals.net} of ${goals.calories} calories`}>
          <circle cx="90" cy="90" r={r} className="ring-track" />
          <circle
            cx="90" cy="90" r={r}
            className={over ? "ring-fill ring-over" : "ring-fill"}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform="rotate(-90 90 90)"
          />
          <text x="90" y="82" className="ring-num">{totals.net}</text>
          <text x="90" y="104" className="ring-sub">net kcal</text>
        </svg>
        <div className={over ? "remaining over" : "remaining"}>
          {over ? `${Math.abs(remaining)} over` : `${remaining} left`}
          <span className="remaining-goal">goal {goals.calories}</span>
        </div>
      </div>

      <div className="summary-side">
        <div className="cal-split">
          <div className="cal-stat">
            <span className="cal-stat-val eaten">{totals.consumed}</span>
            <span className="cal-stat-label">eaten</span>
          </div>
          <span className="cal-op">−</span>
          <div className="cal-stat">
            <span className="cal-stat-val burned">{totals.burned}</span>
            <span className="cal-stat-label">burned</span>
          </div>
        </div>

        <MacroBar label="Protein" value={totals.protein_g} goal={goals.protein_g} cls="protein" />
        <MacroBar label="Carbs" value={totals.carbs_g} goal={goals.carbs_g} cls="carbs" />
        <MacroBar label="Fat" value={totals.fat_g} goal={goals.fat_g} cls="fat" />

        <button className="link-btn goals-btn" onClick={onEditGoals}>
          Adjust goals
        </button>
      </div>
    </section>
  );
}

function MacroBar({ label, value, goal, cls }: { label: string; value: number; goal: number; cls: string }) {
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  return (
    <div className="macro">
      <div className="macro-head">
        <span>{label}</span>
        <span className="macro-val">
          {Math.round(value)}<span className="macro-goal"> / {goal} g</span>
        </span>
      </div>
      <div className="macro-track">
        <div className={`macro-fill ${cls}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
