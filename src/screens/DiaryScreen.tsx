import { useEffect, useState, type ReactNode } from "react";
import type { DayView, DiaryEntry, Goals, MealType } from "../types";
import { MEAL_LABELS, MEAL_TYPES } from "../types";
import { getRepository } from "../data/repository";
import { buildDayView, entryMacros, isAiEstimate, shiftDate, todayISO } from "../features/diary";
import { CalorieRing, MacroBars } from "../components/rings";
import { ChevronLeft, ChevronRight, TrashIcon } from "../components/icons";
import { AiEstimateBadge } from "../components/AiEstimateBadge";

interface Props {
  date: string;
  goals: Goals;
  /** Optional banner (e.g. "build your plan") shown above the Today tracker. */
  banner?: ReactNode;
  nonce: number;
  onChangeDate: (date: string) => void;
  onAddToMeal: (meal: MealType) => void;
  onOpenMeal: (meal: MealType) => void;
  onMutated: () => void;
}

export function DiaryScreen({ date, goals, banner, nonce, onChangeDate, onAddToMeal, onOpenMeal, onMutated }: Props) {
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

  const updateQty = async (entry: DiaryEntry, delta: number) => {
    const next = Math.round((entry.quantity + delta) * 4) / 4; // 0.25 steps
    if (next < 0.25) return;
    const repo = await getRepository();
    await repo.updateDiaryEntry(entry.id, { quantity: next });
    onMutated();
  };

  const remove = async (entry: DiaryEntry) => {
    const repo = await getRepository();
    await repo.removeDiaryEntry(entry.id);
    onMutated();
  };

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

      {MEAL_TYPES.map((meal) => {
        const entries = view?.meals[meal] ?? [];
        const m = view?.perMeal[meal];
        return (
          <section className="meal" key={meal}>
            <button className="meal-head" onClick={() => onOpenMeal(meal)} aria-label={`Open ${MEAL_LABELS[meal]}`}>
              <h2>{MEAL_LABELS[meal]}</h2>
              <span className="meal-cal">{m?.calories ?? 0} cal</span>
            </button>
            <ul className="entry-list">
              {entries.map((e) => {
                const em = entryMacros(e);
                return (
                  <li className="entry" key={e.id}>
                    <div className="entry-main">
                      <div className="entry-title">
                        <span className="entry-name">{e.food.name}</span>
                        {isAiEstimate(e) && <AiEstimateBadge />}
                      </div>
                      <div className="entry-sub">
                        {e.quantity}× {e.food.servingSize}
                        {e.food.brand ? ` · ${e.food.brand}` : ""}
                      </div>
                    </div>
                    <div className="entry-cal">{em.calories}</div>
                    <div className="entry-actions">
                      <button
                        className="step"
                        aria-label="Less"
                        disabled={e.quantity <= 0.25}
                        onClick={() => updateQty(e, -0.25)}
                      >
                        −
                      </button>
                      <button className="step" aria-label="More" onClick={() => updateQty(e, 0.25)}>
                        +
                      </button>
                      <button className="step del" aria-label="Remove" onClick={() => remove(e)}>
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button className="add-to-meal" onClick={() => onAddToMeal(meal)}>
              + Add food
            </button>
          </section>
        );
      })}
    </div>
  );
}

function MealStat({ label, cal, onClick }: { label: string; cal: number; onClick: () => void }) {
  return (
    <button className="meal-stat" onClick={onClick} aria-label={`Add to ${label}`}>
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
