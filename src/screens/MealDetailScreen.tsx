import { useEffect, useState } from "react";
import type { DiaryEntry, Goals, MealType } from "../types";
import { MEAL_LABELS } from "../types";
import { getRepository } from "../data/repository";
import { entryMacros, isAiEstimate } from "../features/diary";
import { BarcodeIcon, DiamondIcon, SearchIcon, TrashIcon } from "../components/icons";
import { AiEstimateBadge } from "../components/AiEstimateBadge";

interface Props {
  date: string;
  meal: MealType;
  goals: Goals;
  nonce: number;
  onScan: () => void;
  onSearch: () => void;
  onAi: () => void;
  onMutated: () => void;
}

/**
 * A single meal's detail: everything already logged to it (each row editable
 * via the quantity steppers and removable via the trash), and the three ways to
 * add more — Scan Barcode, Search, or AI. The page title + back live in the
 * global header; this screen shows only the running subtotal.
 *
 * This sits between the Diary and the Add screen so tapping "Lunch" shows what
 * you've eaten first, instead of dropping straight into a blank search.
 */
export function MealDetailScreen({
  date,
  meal,
  nonce,
  onScan,
  onSearch,
  onAi,
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
      <div className="meal-detail-subhead">
        <span className="meal-detail-cal">{total} cal logged</span>
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

      <div className="meal-cta-row three">
        <button className="meal-cta" onClick={onScan}>
          <BarcodeIcon size={22} />
          <span>Scan Barcode</span>
        </button>
        <button className="meal-cta" onClick={onSearch}>
          <SearchIcon size={20} />
          <span>Search</span>
        </button>
        <button className="meal-cta" onClick={onAi}>
          <DiamondIcon size={20} />
          <span>AI</span>
        </button>
      </div>
    </div>
  );
}
