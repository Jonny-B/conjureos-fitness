import { useState } from "react";
import type { ActivityLevel, GoalDirection, Goals, Profile, Sex } from "../types";
import { DEFAULT_GOALS } from "../types";
import { getRepository } from "../data/repository";
import { ACTIVITY_LABELS, recommendGoals } from "../features/goals";
import { SETUP_STEPS, completedSet } from "../features/setup";
import { NumberField } from "../components/NumberField";
import { ChevronLeft, CloseIcon } from "../components/icons";

const DEFAULT_PROFILE: Profile = {
  sex: "female",
  age: 30,
  heightCm: 170,
  weightKg: 70,
  activityLevel: "moderate",
  direction: "maintain",
  units: "metric",
};

type ProfileDraft = Omit<Profile, "age" | "heightCm" | "weightKg" | "goalWeightKg" | "setup"> & {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  goalWeightKg?: number;
};
type GoalsDraft = { calories?: number; protein?: number; carbs?: number; fat?: number };

const clampNum = (v: number | undefined, min: number, max: number, dflt: number): number =>
  v == null || !Number.isFinite(v) ? dflt : Math.min(max, Math.max(min, Math.round(v)));

interface Props {
  profile: Profile | null;
  goals: Goals;
  /** Which step to open on (from the banner). Defaults to the first unfinished. */
  initialStepId?: string;
  onClose: () => void;
  onSaved: (profile: Profile, goals: Goals) => void;
}

/**
 * Guided, step-by-step profile/goals setup. Each step's "Save & continue"
 * persists the profile (and, on the targets step, the goals) and marks that
 * step complete, so progress survives an early exit and the Home banner can
 * resume at the next unfinished step. Dismissible — never blocks the app.
 */
export function ProfileSetupWizard({ profile, goals, initialStepId, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<ProfileDraft>(profile ?? DEFAULT_PROFILE);
  const [g, setG] = useState<GoalsDraft>(profile ? goals : {});
  const [completed, setCompleted] = useState<Set<string>>(completedSet(profile));
  const [busy, setBusy] = useState(false);

  const startIndex = Math.max(
    0,
    initialStepId ? SETUP_STEPS.findIndex((s) => s.id === initialStepId) : SETUP_STEPS.findIndex((s) => !completed.has(s.id)),
  );
  const [index, setIndex] = useState(startIndex);

  const step = SETUP_STEPS[index]!;
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const toProfile = (nextCompleted: Set<string>): Profile => ({
    ...draft,
    age: clampNum(draft.age, 10, 120, DEFAULT_PROFILE.age),
    heightCm: clampNum(draft.heightCm, 90, 250, DEFAULT_PROFILE.heightCm),
    weightKg: clampNum(draft.weightKg, 25, 400, DEFAULT_PROFILE.weightKg),
    goalWeightKg: draft.goalWeightKg != null ? clampNum(draft.goalWeightKg, 25, 400, draft.goalWeightKg) : undefined,
    setup: { completedSteps: [...nextCompleted] },
  });

  const applyRecommended = () => setG(recommendGoals(toProfile(completed)));

  const saveStep = async () => {
    setBusy(true);
    try {
      const nextCompleted = new Set(completed).add(step.id);
      const fp = toProfile(nextCompleted);
      const fg: Goals = {
        calories: clampNum(g.calories, 0, 10000, DEFAULT_GOALS.calories),
        protein: clampNum(g.protein, 0, 600, DEFAULT_GOALS.protein),
        carbs: clampNum(g.carbs, 0, 900, DEFAULT_GOALS.carbs),
        fat: clampNum(g.fat, 0, 400, DEFAULT_GOALS.fat),
      };
      const repo = await getRepository();
      const writes: Promise<unknown>[] = [repo.saveProfile(fp)];
      if (step.id === "targets") writes.push(repo.saveGoals(fg));
      await Promise.all(writes);
      setCompleted(nextCompleted);
      onSaved(fp, fg);
      if (index >= SETUP_STEPS.length - 1) onClose();
      else setIndex((i) => i + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-wizard">
      <div className="setup-wizard-top">
        {index > 0 ? (
          <button className="icon-btn" aria-label="Back" onClick={() => setIndex((i) => i - 1)}>
            <ChevronLeft size={20} />
          </button>
        ) : (
          <span className="icon-btn-spacer" />
        )}
        <span className="wizard-step-num">Step {index + 1} of {SETUP_STEPS.length}</span>
        <button className="icon-btn" aria-label="Close setup" onClick={onClose}>
          <CloseIcon size={20} />
        </button>
      </div>

      <div className="mode-body wizard-step">
        <div className="wizard-head">
          <h1>{step.title}</h1>
        </div>

        {step.id === "basics" && (
          <>
            <label className="field">
              <span className="field-label">Sex</span>
              <select className="select" value={draft.sex} onChange={(e) => set("sex", e.target.value as Sex)}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Age</span>
              <NumberField value={draft.age} min={10} max={120} onChange={(n) => set("age", n)} aria-label="Age" />
            </label>
          </>
        )}

        {step.id === "body" && (
          <>
            <div className="field">
              <span className="field-label">Units</span>
              <div className="chip-row">
                {(["metric", "imperial"] as const).map((u) => (
                  <button
                    key={u}
                    className={`chip${draft.units === u ? " active" : ""}`}
                    onClick={() => set("units", u)}
                  >
                    {u === "metric" ? "Metric (kg, cm)" : "Imperial (lb, in)"}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span className="field-label">Height (cm)</span>
              <NumberField value={draft.heightCm} min={90} max={250} onChange={(n) => set("heightCm", n)} aria-label="Height in cm" />
            </label>
            <label className="field">
              <span className="field-label">Weight (kg)</span>
              <NumberField value={draft.weightKg} min={25} max={400} onChange={(n) => set("weightKg", n)} aria-label="Weight in kg" />
            </label>
          </>
        )}

        {step.id === "activity" && (
          <>
            <label className="field">
              <span className="field-label">Activity level</span>
              <select className="select" value={draft.activityLevel} onChange={(e) => set("activityLevel", e.target.value as ActivityLevel)}>
                {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
                  <option key={k} value={k}>{ACTIVITY_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Goal</span>
              <select className="select" value={draft.direction} onChange={(e) => set("direction", e.target.value as GoalDirection)}>
                <option value="lose">Lose weight</option>
                <option value="maintain">Maintain</option>
                <option value="gain">Gain weight</option>
              </select>
            </label>
            {draft.direction !== "maintain" && (
              <label className="field">
                <span className="field-label">Goal weight (kg, optional)</span>
                <NumberField value={draft.goalWeightKg} min={25} max={400} onChange={(n) => set("goalWeightKg", n)} aria-label="Goal weight in kg" />
              </label>
            )}
          </>
        )}

        {step.id === "targets" && (
          <>
            <div className="section-label">
              Daily targets
              <button className="link-btn section-action" onClick={applyRecommended}>Use recommended</button>
            </div>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Calories</span>
                <NumberField value={g.calories} min={0} max={10000} onChange={(n) => setG({ ...g, calories: n })} aria-label="Calories" />
              </label>
              <label className="field">
                <span className="field-label">Protein (g)</span>
                <NumberField value={g.protein} min={0} max={600} onChange={(n) => setG({ ...g, protein: n })} aria-label="Protein grams" />
              </label>
              <label className="field">
                <span className="field-label">Carbs (g)</span>
                <NumberField value={g.carbs} min={0} max={900} onChange={(n) => setG({ ...g, carbs: n })} aria-label="Carbs grams" />
              </label>
              <label className="field">
                <span className="field-label">Fat (g)</span>
                <NumberField value={g.fat} min={0} max={400} onChange={(n) => setG({ ...g, fat: n })} aria-label="Fat grams" />
              </label>
            </div>
          </>
        )}

        <div className="wizard-nav">
          <button className="btn primary block" disabled={busy} onClick={saveStep}>
            {busy ? "Saving…" : index >= SETUP_STEPS.length - 1 ? "Finish setup" : "Save & continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
