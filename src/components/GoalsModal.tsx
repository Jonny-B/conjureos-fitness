import { useState } from "react";
import type { Goals } from "../lib/types";

interface Props {
  goals: Goals;
  onSave: (goals: Goals) => Promise<void>;
  onClose: () => void;
}

/** Edit daily macro targets. */
export default function GoalsModal({ goals, onSave, onClose }: Props) {
  const [calories, setCalories] = useState(String(goals.calories));
  const [protein, setProtein] = useState(String(goals.protein_g));
  const [carbs, setCarbs] = useState(String(goals.carbs_g));
  const [fat, setFat] = useState(String(goals.fat_g));
  const [busy, setBusy] = useState(false);

  const intOr = (s: string, d: number) => {
    const n = parseInt(s, 10);
    return isFinite(n) && n >= 0 ? n : d;
  };

  async function save() {
    setBusy(true);
    try {
      await onSave({
        calories: intOr(calories, goals.calories),
        protein_g: intOr(protein, goals.protein_g),
        carbs_g: intOr(carbs, goals.carbs_g),
        fat_g: intOr(fat, goals.fat_g),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h2>Daily goals</h2>
        <div className="goal-grid">
          <label>
            Calories
            <input inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} />
          </label>
          <label>
            Protein (g)
            <input inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </label>
          <label>
            Carbs (g)
            <input inputMode="numeric" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          </label>
          <label>
            Fat (g)
            <input inputMode="numeric" value={fat} onChange={(e) => setFat(e.target.value)} />
          </label>
        </div>
        <div className="edit-actions">
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            Save goals
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
