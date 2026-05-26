import { useState } from "react";
import type { Entry } from "../lib/types";

interface Props {
  entries: Entry[];
  onUpdate: (id: string, patch: Partial<Entry>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/** Today's log, grouped food vs exercise, with tap-to-edit and delete. */
export default function EntryList({ entries, onUpdate, onDelete }: Props) {
  const food = entries.filter((e) => e.kind === "food");
  const exercise = entries.filter((e) => e.kind === "exercise");

  if (entries.length === 0) {
    return (
      <section className="card empty">
        <p>Nothing logged yet. Describe your first meal above ↑</p>
      </section>
    );
  }

  return (
    <section className="entries">
      {food.length > 0 && (
        <Group title="Food" total={`${Math.round(sum(food))} kcal`}>
          {food.map((e) => (
            <Row key={e.id} entry={e} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </Group>
      )}
      {exercise.length > 0 && (
        <Group title="Exercise" total={`−${Math.round(sum(exercise))} kcal`}>
          {exercise.map((e) => (
            <Row key={e.id} entry={e} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </Group>
      )}
    </section>
  );
}

const sum = (es: Entry[]) => es.reduce((a, e) => a + e.calories, 0);

function Group({ title, total, children }: { title: string; total: string; children: React.ReactNode }) {
  return (
    <div className="card group">
      <div className="group-head">
        <h3>{title}</h3>
        <span className="group-total">{total}</span>
      </div>
      <ul className="group-list">{children}</ul>
    </div>
  );
}

function Row({ entry, onUpdate, onDelete }: { entry: Entry } & Pick<Props, "onUpdate" | "onDelete">) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(entry.name);
  const [quantity, setQuantity] = useState(entry.quantity ?? "");
  const [calories, setCalories] = useState(String(entry.calories));
  const [protein, setProtein] = useState(String(entry.protein_g ?? 0));
  const [carbs, setCarbs] = useState(String(entry.carbs_g ?? 0));
  const [fat, setFat] = useState(String(entry.fat_g ?? 0));

  const numOr0 = (s: string) => {
    const n = parseFloat(s);
    return isFinite(n) && n >= 0 ? n : 0;
  };

  async function save() {
    setBusy(true);
    try {
      const patch: Partial<Entry> =
        entry.kind === "food"
          ? {
              name: name.trim() || entry.name,
              quantity: quantity.trim() || null,
              calories: numOr0(calories),
              protein_g: numOr0(protein),
              carbs_g: numOr0(carbs),
              fat_g: numOr0(fat),
            }
          : {
              name: name.trim() || entry.name,
              quantity: quantity.trim() || null,
              calories: numOr0(calories),
            };
      await onUpdate(entry.id, patch);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="entry editing">
        <div className="edit-grid">
          <label className="edit-name">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Quantity
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label>
            kcal
            <input inputMode="decimal" value={calories} onChange={(e) => setCalories(e.target.value)} />
          </label>
          {entry.kind === "food" && (
            <>
              <label>
                Protein g
                <input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
              </label>
              <label>
                Carbs g
                <input inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
              </label>
              <label>
                Fat g
                <input inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="edit-actions">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
            Save
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="entry">
      <button className="entry-main" onClick={() => setEditing(true)} title="Edit">
        <span className="entry-name">{entry.name}</span>
        {entry.quantity && <span className="entry-qty">{entry.quantity}</span>}
        {entry.kind === "food" && (
          <span className="entry-macros">
            P {Math.round(entry.protein_g ?? 0)} · C {Math.round(entry.carbs_g ?? 0)} · F{" "}
            {Math.round(entry.fat_g ?? 0)}
          </span>
        )}
      </button>
      <span className={entry.kind === "food" ? "entry-cal" : "entry-cal burned"}>
        {entry.kind === "food" ? "" : "−"}
        {Math.round(entry.calories)}
      </span>
      <button className="entry-del" onClick={() => onDelete(entry.id)} aria-label="Delete" title="Delete">
        ×
      </button>
    </li>
  );
}
