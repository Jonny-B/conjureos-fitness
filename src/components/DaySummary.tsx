import type { DayTotals, Goals, Meal, MealTotals } from "../lib/types";
import { MEALS, MEAL_LABELS } from "../lib/types";

interface Props {
  totals: DayTotals;
  meals: MealTotals;
  goals: Goals;
  activeMeal: Meal;
  onSelectMeal: (m: Meal) => void;
  onEditGoals: () => void;
}

/** The day's headline, framed as a calorie *budget*:
 *  remaining = goal − food eaten + exercise burned, shown big in the ring,
 *  with the meal slots as tappable satellites (they drive the logger). */
export default function DaySummary({ totals, meals, goals, activeMeal, onSelectMeal, onEditGoals }: Props) {
  const remaining = goals.calories - totals.net;
  const over = remaining < 0;
  const pct = goals.calories > 0 ? Math.min(1, Math.max(0, totals.net / goals.calories)) : 0;

  const r = 82;
  const c = 2 * Math.PI * r;

  return (
    <section className="summary card">
      <div className="budget-head">
        <span className="budget-label">Calorie budget</span>
        <span className="budget-goal">{goals.calories.toLocaleString()} kcal</span>
      </div>

      <div className="ring-wrap">
        <svg viewBox="0 0 184 184" className="ring" role="img"
             aria-label={`${Math.abs(remaining)} calories ${over ? "over" : "remaining"}`}>
          <circle cx="92" cy="92" r={r} className="ring-track" />
          <circle
            cx="92" cy="92" r={r}
            className={over ? "ring-fill ring-over" : "ring-fill"}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform="rotate(-90 92 92)"
          />
          <text x="92" y="86" className={over ? "ring-num over" : "ring-num"}>
            {Math.abs(remaining).toLocaleString()}
          </text>
          <text x="92" y="110" className="ring-sub">{over ? "over budget" : "kcal left"}</text>
        </svg>
      </div>

      <div className="budget-math">
        <Term value={goals.calories} label="budget" />
        <span className="math-op">−</span>
        <Term value={totals.consumed} label="food" cls="eaten" />
        <span className="math-op">+</span>
        <Term value={totals.burned} label="exercise" cls="burned" />
      </div>

      <div className="meal-tiles">
        {MEALS.map((m) => (
          <button
            key={m}
            className={m === activeMeal ? "meal-tile active" : "meal-tile"}
            onClick={() => onSelectMeal(m)}
          >
            <span className="meal-tile-label">{MEAL_LABELS[m]}</span>
            <span className="meal-tile-kcal">{meals[m]}</span>
          </button>
        ))}
      </div>

      <div className="macros">
        <MacroBar label="Protein" value={totals.protein_g} goal={goals.protein_g} cls="protein" />
        <MacroBar label="Carbs" value={totals.carbs_g} goal={goals.carbs_g} cls="carbs" />
        <MacroBar label="Fat" value={totals.fat_g} goal={goals.fat_g} cls="fat" />
      </div>

      <button className="link-btn goals-btn" onClick={onEditGoals}>
        Adjust goals
      </button>
    </section>
  );
}

function Term({ value, label, cls }: { value: number; label: string; cls?: string }) {
  return (
    <span className="math-term">
      <span className={cls ? `math-val ${cls}` : "math-val"}>{Math.round(value).toLocaleString()}</span>
      <span className="math-label">{label}</span>
    </span>
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
