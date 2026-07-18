import { useEffect, useState } from "react";
import type { DiaryEntry, FoodItem, Goals, MealType } from "../types";
import { MEAL_LABELS, MEAL_TYPES } from "../types";
import { getRepository } from "../data/repository";
import { entryMacros, isAiEstimate } from "../features/diary";
import { BarcodeIcon, DiamondIcon, EditIcon, SearchIcon, TrashIcon } from "../components/icons";
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
  const [qty, setQty] = useState(entry.quantity);
  const [cal, setCal] = useState(entry.food.perServing.calories);
  const [protein, setProtein] = useState(entry.food.perServing.protein);
  const [carbs, setCarbs] = useState(entry.food.perServing.carbs);
  const [fat, setFat] = useState(entry.food.perServing.fat);
  const [busy, setBusy] = useState(false);

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
      quantity: Math.max(0.25, Math.round(qty * 4) / 4),
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
              <input
                className="text-input"
                inputMode="decimal"
                type="text"
                value={String(qty)}
                onChange={(e) => setQty(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
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
