import { useState, type ReactNode } from "react";
import type { ActivityLevel, GoalDirection, Goals, Profile, Sex } from "../types";
import { getRepository } from "../data/repository";
import { ACTIVITY_LABELS, recommendGoals } from "../features/goals";

const DEFAULT_PROFILE: Profile = {
  sex: "female",
  age: 30,
  heightCm: 170,
  weightKg: 70,
  activityLevel: "moderate",
  direction: "maintain",
  units: "metric",
};

/**
 * Profile + goals editor. Editing the profile recomputes recommended goals
 * (Mifflin-St Jeor); the user can still hand-override any goal number. Saves
 * both through the repository.
 */
export function SettingsSheet({
  goals,
  profile,
  onClose,
  onSave,
}: {
  goals: Goals;
  profile: Profile | null;
  onClose: () => void;
  onSave: (goals: Goals, profile: Profile) => void;
}) {
  const [p, setP] = useState<Profile>(profile ?? DEFAULT_PROFILE);
  const [g, setG] = useState<Goals>(goals);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setP((prev) => ({ ...prev, [key]: value }));

  const applyRecommended = () => setG(recommendGoals(p));

  const save = async () => {
    setBusy(true);
    try {
      const repo = await getRepository();
      await Promise.all([repo.saveProfile(p), repo.saveGoals(g)]);
      onSave(g, p);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Profile &amp; goals</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="sheet-body">
          <div className="form-grid">
            <Field label="Sex">
              <select className="select" value={p.sex} onChange={(e) => set("sex", e.target.value as Sex)}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </Field>
            <Field label="Age">
              <input className="text-input" type="number" value={p.age} onChange={(e) => set("age", clamp(e.target.value, 10, 120))} />
            </Field>
            <Field label="Height (cm)">
              <input className="text-input" type="number" value={p.heightCm} onChange={(e) => set("heightCm", clamp(e.target.value, 90, 250))} />
            </Field>
            <Field label="Weight (kg)">
              <input className="text-input" type="number" value={p.weightKg} onChange={(e) => set("weightKg", clamp(e.target.value, 25, 400))} />
            </Field>
          </div>

          <Field label="Activity level">
            <select
              className="select"
              value={p.activityLevel}
              onChange={(e) => set("activityLevel", e.target.value as ActivityLevel)}
            >
              {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
                <option key={k} value={k}>
                  {ACTIVITY_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Goal">
            <select className="select" value={p.direction} onChange={(e) => set("direction", e.target.value as GoalDirection)}>
              <option value="lose">Lose weight</option>
              <option value="maintain">Maintain</option>
              <option value="gain">Gain weight</option>
            </select>
          </Field>

          <button className="btn block" onClick={applyRecommended}>
            Use recommended goals
          </button>

          <div className="form-grid">
            <Field label="Calories">
              <input className="text-input" type="number" value={g.calories} onChange={(e) => setG({ ...g, calories: clamp(e.target.value, 0, 10000) })} />
            </Field>
            <Field label="Protein (g)">
              <input className="text-input" type="number" value={g.protein} onChange={(e) => setG({ ...g, protein: clamp(e.target.value, 0, 600) })} />
            </Field>
            <Field label="Carbs (g)">
              <input className="text-input" type="number" value={g.carbs} onChange={(e) => setG({ ...g, carbs: clamp(e.target.value, 0, 900) })} />
            </Field>
            <Field label="Fat (g)">
              <input className="text-input" type="number" value={g.fat} onChange={(e) => setG({ ...g, fat: clamp(e.target.value, 0, 400) })} />
            </Field>
          </div>
        </div>

        <footer className="sheet-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function clamp(raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}
