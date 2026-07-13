import { useState, type ReactNode } from "react";
import type { ActivityLevel, GoalDirection, Goals, Profile, Sex } from "../types";
import { DEFAULT_GOALS } from "../types";
import { getRepository } from "../data/repository";
import { ACTIVITY_LABELS, recommendGoals } from "../features/goals";
import { NumberField } from "../components/NumberField";
import { heightToCm, heightToDisplay, heightUnit, weightToDisplay, weightToKg, weightUnit } from "../features/units";
import { CloseIcon } from "../components/icons";

const DEFAULT_PROFILE: Profile = {
  sex: "female",
  age: 30,
  heightCm: 170,
  weightKg: 70,
  activityLevel: "moderate",
  direction: "maintain",
  units: "metric",
};

// While editing, the numeric fields may be empty (undefined). They're coerced
// back to valid numbers (clamped, defaulted) at save — see toProfile/toGoals.
type ProfileDraft = Omit<Profile, "age" | "heightCm" | "weightKg"> & {
  age?: number;
  heightCm?: number;
  weightKg?: number;
};
type GoalsDraft = { calories?: number; protein?: number; carbs?: number; fat?: number };

function clampNum(v: number | undefined, min: number, max: number, dflt: number): number {
  if (v == null || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.round(v)));
}
function toProfile(d: ProfileDraft): Profile {
  return {
    ...d,
    age: clampNum(d.age, 10, 120, DEFAULT_PROFILE.age),
    heightCm: clampNum(d.heightCm, 90, 250, DEFAULT_PROFILE.heightCm),
    weightKg: clampNum(d.weightKg, 25, 400, DEFAULT_PROFILE.weightKg),
  };
}
function toGoals(d: GoalsDraft): Goals {
  return {
    calories: clampNum(d.calories, 0, 10000, DEFAULT_GOALS.calories),
    protein: clampNum(d.protein, 0, 600, DEFAULT_GOALS.protein),
    carbs: clampNum(d.carbs, 0, 900, DEFAULT_GOALS.carbs),
    fat: clampNum(d.fat, 0, 400, DEFAULT_GOALS.fat),
  };
}

/**
 * Profile + goals editor. Editing the profile recomputes recommended goals
 * (Mifflin-St Jeor) on demand; the user can still hand-override any goal
 * number. Numeric fields hold a raw string while editing (via NumberField) so
 * typing and clearing work; values are clamped only at save.
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
  const [p, setP] = useState<ProfileDraft>(profile ?? DEFAULT_PROFILE);
  const [g, setG] = useState<GoalsDraft>(goals);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setP((prev) => ({ ...prev, [key]: value }));

  const applyRecommended = () => setG(recommendGoals(toProfile(p)));

  const save = async () => {
    setBusy(true);
    try {
      const fp = toProfile(p);
      const fg = toGoals(g);
      const repo = await getRepository();
      await Promise.all([repo.saveProfile(fp), repo.saveGoals(fg)]);
      onSave(fg, fp);
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
            <CloseIcon size={20} />
          </button>
        </header>

        <div className="sheet-body">
          <div className="section-label">About you</div>
          <div className="form-grid">
            <Field label="Sex">
              <select className="select" value={p.sex} onChange={(e) => set("sex", e.target.value as Sex)}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </Field>
            <Field label="Age">
              <NumberField value={p.age} min={10} max={120} onChange={(n) => set("age", n)} aria-label="Age" />
            </Field>
            <Field label={`Height (${heightUnit(p.units)})`}>
              <NumberField
                value={p.heightCm == null ? undefined : heightToDisplay(p.heightCm, p.units)}
                min={heightToDisplay(90, p.units)}
                max={heightToDisplay(250, p.units)}
                onChange={(n) => set("heightCm", n == null ? undefined : Math.round(heightToCm(n, p.units)))}
                aria-label="Height"
              />
            </Field>
            <Field label={`Weight (${weightUnit(p.units)})`}>
              <NumberField
                value={p.weightKg == null ? undefined : weightToDisplay(p.weightKg, p.units)}
                min={weightToDisplay(25, p.units)}
                max={weightToDisplay(400, p.units)}
                onChange={(n) => set("weightKg", n == null ? undefined : Math.round(weightToKg(n, p.units) * 10) / 10)}
                aria-label="Weight"
              />
            </Field>
          </div>

          <Field label="Units">
            <div className="chip-row">
              {(["metric", "imperial"] as const).map((u) => (
                <button key={u} className={`chip${p.units === u ? " active" : ""}`} onClick={() => set("units", u)}>
                  {u === "metric" ? "Metric (kg, cm)" : "Imperial (lb, in)"}
                </button>
              ))}
            </div>
          </Field>

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

          <div className="section-label">
            Daily targets
            <button className="link-btn section-action" onClick={applyRecommended}>
              Use recommended
            </button>
          </div>

          <div className="form-grid">
            <Field label="Calories">
              <NumberField value={g.calories} min={0} max={10000} onChange={(n) => setG({ ...g, calories: n })} aria-label="Calories" />
            </Field>
            <Field label="Protein (g)">
              <NumberField value={g.protein} min={0} max={600} onChange={(n) => setG({ ...g, protein: n })} aria-label="Protein grams" />
            </Field>
            <Field label="Carbs (g)">
              <NumberField value={g.carbs} min={0} max={900} onChange={(n) => setG({ ...g, carbs: n })} aria-label="Carbs grams" />
            </Field>
            <Field label="Fat (g)">
              <NumberField value={g.fat} min={0} max={400} onChange={(n) => setG({ ...g, fat: n })} aria-label="Fat grams" />
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
