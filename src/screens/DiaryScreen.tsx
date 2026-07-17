import { useEffect, useState, type ReactNode } from "react";
import type { DayView, Goals, MealType, Plan, Profile } from "../types";
import { MEAL_LABELS } from "../types";
import { getRepository } from "../data/repository";
import { buildDayView, shiftDate, todayISO } from "../features/diary";
import { CalorieRing, MacroBars } from "../components/rings";
import { ChevronLeft, ChevronRight } from "../components/icons";
import { WeightCard } from "../components/WeightCard";
import { CoachPlanCard } from "../components/CoachPlanCard";

interface Props {
  date: string;
  goals: Goals;
  /** Optional banner (e.g. "build your plan") shown above the Today tracker. */
  banner?: ReactNode;
  nonce: number;
  plan: Plan | null;
  profile: Profile | null;
  onChangeDate: (date: string) => void;
  onOpenMeal: (meal: MealType) => void;
  onOpenPlan: () => void;
}

export function DiaryScreen({
  date,
  goals,
  banner,
  nonce,
  plan,
  profile,
  onChangeDate,
  onOpenMeal,
  onOpenPlan,
}: Props) {
  const [view, setView] = useState<DayView | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const repo = await getRepository();
      const entries = await repo.listDiary(date);
      if (alive) setView(buildDayView(date, entries));
    })();
    return () => {
      alive = false;
    };
  }, [date, nonce]);

  const isToday = date === todayISO();
  const total = view?.total ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const mealCal = (m: MealType) => view?.perMeal[m].calories ?? 0;

  return (
    <div className="diary">
      {banner}
      <div className="date-nav">
        <button className="icon-btn" aria-label="Previous day" onClick={() => onChangeDate(shiftDate(date, -1))}>
          <ChevronLeft size={20} />
        </button>
        <button
          className="date-label"
          onClick={() => onChangeDate(todayISO())}
          title={isToday ? undefined : "Jump to today"}
        >
          {isToday ? "Today" : formatDate(date)}
        </button>
        <button
          className="icon-btn"
          aria-label="Next day"
          disabled={isToday}
          onClick={() => onChangeDate(shiftDate(date, 1))}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <section className="budget-card">
        <div className="budget-head">
          <span className="budget-label">Calorie Budget</span>
          <span className="budget-value">{goals.calories.toLocaleString()}</span>
        </div>

        <div className="budget-grid">
          <div className="budget-col">
            <MealStat label={MEAL_LABELS.breakfast} cal={mealCal("breakfast")} onClick={() => onOpenMeal("breakfast")} />
            <MealStat label={MEAL_LABELS.lunch} cal={mealCal("lunch")} onClick={() => onOpenMeal("lunch")} />
          </div>
          <CalorieRing consumed={total.calories} goal={goals.calories} />
          <div className="budget-col">
            <MealStat label={MEAL_LABELS.dinner} cal={mealCal("dinner")} onClick={() => onOpenMeal("dinner")} />
            <MealStat label={MEAL_LABELS.snacks} cal={mealCal("snacks")} onClick={() => onOpenMeal("snacks")} />
          </div>
        </div>

        <div className="budget-foot">
          <span className="summary-eaten">
            <strong>{total.calories}</strong> eaten · goal {goals.calories.toLocaleString()}
          </span>
        </div>

        <MacroBars total={total} goals={goals} />
      </section>

      <WeightCard profile={profile} />
      <CoachPlanCard plan={plan} goals={goals} onOpen={onOpenPlan} />
    </div>
  );
}

function MealStat({ label, cal, onClick }: { label: string; cal: number; onClick: () => void }) {
  return (
    <button className="meal-stat" onClick={onClick} aria-label={`Open ${label}`}>
      <span className="meal-stat-label">{label}</span>
      <span className="meal-stat-cal">{cal}</span>
    </button>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
