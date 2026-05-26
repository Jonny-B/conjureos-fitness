import type { Goals } from "../lib/types";

export interface DayBar {
  date: string; // YYYY-MM-DD
  net: number;
}

interface Props {
  days: DayBar[]; // oldest → newest, length 7
  goals: Goals;
  selected: string;
  onSelect: (date: string) => void;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Last 7 days of net calories as bars, with the goal as a reference line. */
export default function WeeklyChart({ days, goals, selected, onSelect }: Props) {
  const max = Math.max(goals.calories, ...days.map((d) => d.net), 1);
  const goalPct = (goals.calories / max) * 100;

  return (
    <section className="card week">
      <div className="group-head">
        <h3>This week</h3>
        <span className="group-total">goal {goals.calories}</span>
      </div>
      <div className="week-chart">
        <div className="goal-line" style={{ bottom: `calc(${goalPct}% + 22px)` }} aria-hidden />
        {days.map((d) => {
          const h = Math.max(2, (Math.max(0, d.net) / max) * 100);
          const over = d.net > goals.calories;
          const isSel = d.date === selected;
          const wd = WEEKDAY[new Date(d.date + "T00:00:00").getDay()];
          return (
            <button
              key={d.date}
              className={`week-col${isSel ? " sel" : ""}`}
              onClick={() => onSelect(d.date)}
              title={`${d.date}: ${d.net} kcal`}
            >
              <span className="week-val">{d.net > 0 ? d.net : ""}</span>
              <span className={`week-bar${over ? " over" : ""}`} style={{ height: `${h}%` }} />
              <span className="week-day">{wd}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
