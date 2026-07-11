import { useEffect, useState } from "react";
import type { DiaryEntry, Goals, MealType } from "../types";
import { MEAL_LABELS } from "../types";
import { getRepository } from "../data/repository";
import { entryMacros, isAiEstimate } from "../features/diary";
import { ChevronLeft, PackageIcon, SearchIcon, TrashIcon } from "../components/icons";
import { AiEstimateBadge } from "../components/AiEstimateBadge";

interface Props {
  date: string;
  meal: MealType;
  goals: Goals;
  nonce: number;
  onBack: () => void;
  onAdd: () => void;
  onScan: () => void;
  onMutated: () => void;
}

/**
 * A single meal's detail: the meal label, everything already logged to it
 * (each row editable via the quantity steppers and removable via the trash),
 * and the two ways to add more — Scan a barcode or open the full Add flow.
 *
 * This sits between the Diary and the Add screen so tapping "Lunch" shows what
 * you've eaten first, instead of dropping straight into a blank search.
 */
export function MealDetailScreen({
  date,
  meal,
  nonce,
  onBack,
  onAdd,
  onScan,
  onMutated,
}: Props) {
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const repo = await getRepository();
      const all = await repo.listDiary(date);
      if (alive) setEntries(all.filter((e) => e.meal === meal));
    })();
    return () => {
      alive = false;
    };
  }, [date, meal, nonce]);

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

  const list = entries ?? [];
  const total = list.reduce((sum, e) => sum + entryMacros(e).calories, 0);

  return (
    <div className="meal-detail">
      <div className="meal-detail-head">
        <button className="icon-btn" aria-label="Back to diary" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <div className="meal-detail-title">
          <h1>{MEAL_LABELS[meal]}</h1>
          <span className="meal-detail-cal">{total} cal</span>
        </div>
      </div>

      {entries === null ? (
        <div className="center-fill">
          <div className="spinner" />
        </div>
      ) : list.length === 0 ? (
        <p className="meal-detail-empty muted">
          Nothing logged to {MEAL_LABELS[meal].toLowerCase()} yet.
        </p>
      ) : (
        <ul className="entry-list">
          {list.map((e) => {
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
      )}

      <div className="meal-cta-row">
        <button className="meal-cta" onClick={onScan}>
          <PackageIcon size={20} />
          <span>Scan a barcode</span>
        </button>
        <button className="meal-cta primary" onClick={onAdd}>
          <SearchIcon size={20} />
          <span>Add food</span>
        </button>
      </div>
    </div>
  );
}
