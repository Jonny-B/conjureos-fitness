import { useEffect, useState } from "react";
import type { DiaryEntry, FoodItem, Goals, MealType } from "../types";
import { MEAL_LABELS, MEAL_TYPES } from "../types";
import { getRepository } from "../data/repository";
import { entryMacros, isAiEstimate } from "../features/diary";
import { recentFoodsForMeal, type RecentFood } from "../features/recentFoods";
import { BarcodeIcon, DiamondIcon, EditIcon, SearchIcon, TrashIcon } from "../components/icons";
import { AiEstimateBadge } from "../components/AiEstimateBadge";
import { useScrollLock } from "../hooks/useScrollLock";
import { NumberField } from "../components/NumberField";

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
/** Smallest loggable portion. Also the floor the +/- steppers stop at. */
export const MIN_QTY = 0.1;

/** How far back the meal history looks, and how many rows it shows. Short on
 *  purpose — this is a scannable shortcut list, not an archive. */
const HISTORY_DAYS = 7;
const HISTORY_LIMIT = 10;

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
  // The entry currently open in the edit modal, or null.
  const [editing, setEditing] = useState<DiaryEntry | null>(null);

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
                  <button className="step" aria-label="Edit" onClick={() => setEditing(e)}>
                    <EditIcon size={16} />
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

      <MealHistory meal={meal} date={date} nonce={nonce} onLogged={onMutated} />

      {editing && (
        <EntryEditModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onMutated();
          }}
        />
      )}
    </div>
  );
}

/**
 * What you last put in this meal, over the past week.
 *
 * Sits under the add buttons rather than above them: it's a shortcut for the
 * common case, not the primary action, and someone who wants something new
 * shouldn't have to scroll past a week of breakfasts to reach Search.
 *
 * A week rather than the 30 days the search screen uses — this list is meant
 * to stay short enough to scan, and what you ate last Tuesday is a better
 * suggestion than what you ate a month ago.
 */
function MealHistory({
  meal,
  date,
  nonce,
  onLogged,
}: {
  meal: MealType;
  date: string;
  nonce: number;
  onLogged: () => void;
}) {
  const [recents, setRecents] = useState<RecentFood[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    recentFoodsForMeal(meal, { days: HISTORY_DAYS, limit: HISTORY_LIMIT })
      .then((r) => {
        if (alive) setRecents(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [meal, nonce]);

  if (recents.length === 0) return null;

  const relog = async (r: RecentFood) => {
    const key = `${r.food.name}-${r.lastLoggedAt}`;
    if (busy) return;
    setBusy(key);
    try {
      const repo = await getRepository();
      await repo.addDiaryEntry({ date, meal, quantity: r.quantity, food: r.food });
      onLogged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="meal-history">
      <div className="section-label">History</div>
      <ul className="history-list">
        {recents.map((r) => {
          const key = `${r.food.name}-${r.lastLoggedAt}`;
          const cal = Math.round(r.food.perServing.calories * r.quantity);
          return (
            <li key={key}>
              <button className="history-item" disabled={busy !== null} onClick={() => relog(r)}>
                <span className="history-body">
                  <span className="entry-name">{r.food.name}</span>
                  <span className="entry-sub">
                    {r.quantity !== 1 ? `${r.quantity}\u00d7 ` : ""}
                    {r.food.servingSize}
                    {r.food.brand ? ` \u00b7 ${r.food.brand}` : ""}
                  </span>
                </span>
                <span className="history-cal">{cal}</span>
                <span className="history-add" aria-hidden>
                  +
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Edit a logged diary entry: fix the name/serving/macros, change how much, MOVE
 * it to a different meal, or delete it. Edits patch the entry's food snapshot
 * (per-serving macros) + meal + quantity in one save.
 */
function EntryEditModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: DiaryEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(entry.food.name);
  const [serving, setServing] = useState(entry.food.servingSize);
  const [meal, setMeal] = useState<MealType>(entry.meal);
  const [qty, setQty] = useState<number | undefined>(entry.quantity);
  const [cal, setCal] = useState(entry.food.perServing.calories);
  const [protein, setProtein] = useState(entry.food.perServing.protein);
  const [carbs, setCarbs] = useState(entry.food.perServing.carbs);
  const [fat, setFat] = useState(entry.food.perServing.fat);
  const [busy, setBusy] = useState(false);
  useScrollLock();

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const food: FoodItem = {
      ...entry.food,
      name: trimmed.slice(0, 80),
      servingSize: serving.trim() || entry.food.servingSize,
      perServing: {
        calories: Math.max(0, Math.round(cal)),
        protein: Math.max(0, Math.round(protein)),
        carbs: Math.max(0, Math.round(carbs)),
        fat: Math.max(0, Math.round(fat)),
      },
    };
    const repo = await getRepository();
    await repo.updateDiaryEntry(entry.id, {
      food,
      meal,
      // 2dp, not quarters: the steppers move in 0.25s but a TYPED 0.3 or 1.75
      // should survive the save rather than snapping to the nearest quarter.
      quantity: Math.max(MIN_QTY, Math.round((qty ?? MIN_QTY) * 100) / 100),
    });
    onSaved();
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const repo = await getRepository();
    await repo.removeDiaryEntry(entry.id);
    onSaved();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet entry-edit" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Edit item</h2>
          <button className="link-btn" onClick={onClose}>
            Cancel
          </button>
        </header>

        <div className="sheet-body">
          <label className="field">
            <span>Name</span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Food name" />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Meal</span>
              <select className="select" value={meal} onChange={(e) => setMeal(e.target.value as MealType)}>
                {MEAL_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {MEAL_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Quantity (servings)</span>
              {/* NumberField, not a raw input: a controlled `String(Number(v))`
                  field erases the trailing dot the instant you type "0.", so a
                  decimal quantity could never be entered. */}
              <NumberField
                value={qty}
                onChange={setQty}
                min={MIN_QTY}
                max={99}
                decimals={2}
                aria-label="Quantity (servings)"
              />
            </label>
          </div>

          <label className="field">
            <span>Serving</span>
            <input
              className="text-input"
              value={serving}
              onChange={(e) => setServing(e.target.value)}
              placeholder="e.g. 1 cup (240 g)"
            />
          </label>

          <div className="macros-edit-row">
            <MacroBox label="Calories" value={cal} onChange={setCal} />
            <MacroBox label="Protein (g)" value={protein} onChange={setProtein} />
            <MacroBox label="Carbs (g)" value={carbs} onChange={setCarbs} />
            <MacroBox label="Fat (g)" value={fat} onChange={setFat} />
          </div>
          <div className="muted small">Macros are per one serving.</div>
        </div>

        <footer className="sheet-foot entry-edit-foot">
          <button className="btn danger" disabled={busy} onClick={remove}>
            <TrashIcon size={16} /> Delete
          </button>
          <button className="btn primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function MacroBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="macro-edit plain">
      <span className="macro-edit-label">{label}</span>
      <input
        className="macro-edit-input"
        aria-label={label}
        inputMode="decimal"
        type="text"
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
      />
    </label>
  );
}
