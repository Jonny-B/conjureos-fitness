/**
 * Presentational nutrition widgets: a calorie progress ring and macro bars.
 * Pure SVG/CSS, no dependencies. Stateless — they render whatever macros they
 * are handed.
 */

import type { Goals, Macros } from "../types";
import { pctOf } from "../features/diary";

export function CalorieRing({ consumed, goal }: { consumed: number; goal: number }) {
  const remaining = goal - consumed;
  const pct = Math.min(100, pctOf(consumed, goal));
  const over = consumed > goal;
  const R = 52;
  const C = 2 * Math.PI * R;
  const dash = (pct / 100) * C;

  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 120 120" className="ring" role="img" aria-label={`${consumed} of ${goal} calories`}>
        <circle cx="60" cy="60" r={R} className="ring-track" />
        <circle
          cx="60"
          cy="60"
          r={R}
          className={`ring-value${over ? " over" : ""}`}
          strokeDasharray={`${dash} ${C}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="ring-center">
        <div className="ring-number">{Math.abs(remaining)}</div>
        <div className="ring-label">{over ? "cal over" : "cal left"}</div>
      </div>
    </div>
  );
}

export function MacroBars({ total, goals }: { total: Macros; goals: Goals }) {
  const rows: Array<{ key: keyof Macros; label: string; cls: string; goal: number }> = [
    { key: "protein", label: "Protein", cls: "protein", goal: goals.protein },
    { key: "carbs", label: "Carbs", cls: "carbs", goal: goals.carbs },
    { key: "fat", label: "Fat", cls: "fat", goal: goals.fat },
  ];
  return (
    <div className="macro-bars">
      {rows.map((r) => {
        const value = total[r.key];
        const pct = Math.min(100, pctOf(value, r.goal));
        return (
          <div className="macro-row" key={r.key}>
            <div className="macro-head">
              <span className="macro-label">{r.label}</span>
              <span className="macro-amt">
                {value} / {r.goal} g
              </span>
            </div>
            <div className="macro-track">
              <div className={`macro-fill ${r.cls}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
