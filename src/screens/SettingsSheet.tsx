import { useState, type ReactNode } from "react";
import type { ActivityLevel, ExperienceLevel, Goals, Plan, PlanGoal, PlanMode, Profile, Sex } from "../types";
import { DEFAULT_GOALS, DEFAULT_PROFILE } from "../types";
import { getRepository } from "../data/repository";
import { ACTIVITY_LABELS, deriveDirection, recommendGoals } from "../features/goals";
import { goalsToTargets, saveProgram, targetsToGoals, updatePlan } from "../features/plan/planService";
import { ProgramEditor } from "../components/ProgramEditor";
import { GoalWeightField, HeightField, PlanDatesField, weeksBetween } from "../components/PlanFields";
import { NumberField } from "../components/NumberField";
import { weightToDisplay, weightToKg, weightUnit } from "../features/units";
import { CloseIcon } from "../components/icons";
import { useScrollLock } from "../hooks/useScrollLock";

const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};
const SEX_OPTS: Record<Sex, string> = { female: "Female", male: "Male", not_shared: "Not Shared" };

/** Which surface the settings sheet opens on. "program" deep-links straight to
 *  the workout-program editor (e.g. from the Workouts tab's "Edit plan"). */
export type SettingsView = "main" | "program";

const PLAN_MODE_LABELS: Record<PlanMode, string> = {
  eat_better: "Eat better (food only)",
  get_fit: "Get fit (workouts only)",
  both: "Both — food & workouts",
  logging_only: "Just logging (no plan prescriptions)",
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
  const weightKg = clampNum(d.weightKg, 25, 400, DEFAULT_PROFILE.weightKg);
  return {
    ...d,
    age: clampNum(d.age, 10, 120, DEFAULT_PROFILE.age),
    heightCm: clampNum(d.heightCm, 90, 250, DEFAULT_PROFILE.heightCm),
    weightKg,
    // Direction is derived from goal weight vs weight (no selector anymore):
    // below = lose, above = gain, blank/±1 kg = maintain.
    direction: deriveDirection(weightKg, d.goalWeightKg),
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
 * The single plan + profile + goals editor (the cog). Edits body/activity, the
 * daily nutrition targets, the plan's mode + goal lines, and — via a sub-view —
 * the workout program. All plan writes route through `planService`; when a plan
 * exists the nutrition targets are stored ON the plan (so the diary rings track
 * it), otherwise they fall back to the standalone Goals store.
 */
export function SettingsSheet({
  goals,
  profile,
  plan,
  initialView = "main",
  onClose,
  onSave,
  onPlanChange,
  onStartNewPlan,
}: {
  goals: Goals;
  profile: Profile | null;
  plan: Plan | null;
  initialView?: SettingsView;
  onClose: () => void;
  onSave: (goals: Goals, profile: Profile) => void;
  onPlanChange: (plan: Plan) => void;
  /** Open the wizard to rebuild the whole plan (history is preserved). */
  onStartNewPlan: () => void;
}) {
  const [p, setP] = useState<ProfileDraft>(profile ?? DEFAULT_PROFILE);
  // Nutrition targets shown reflect the plan when it drives them.
  const [g, setG] = useState<GoalsDraft>(targetsToGoals(plan, goals));
  const [mode, setMode] = useState<PlanMode>(plan?.mode ?? "both");
  const [planGoals, setPlanGoals] = useState<PlanGoal[]>(plan?.goals ?? []);
  const [startDate, setStartDate] = useState(plan?.startDate ?? "");
  const [endDate, setEndDate] = useState(plan?.endDate ?? "");
  const [view, setView] = useState<SettingsView>(
    initialView === "program" && plan?.program ? "program" : "main",
  );
  const [busy, setBusy] = useState(false);
  useScrollLock();

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setP((prev) => ({ ...prev, [key]: value }));

  // Units is a display preference, not a numeric edit — apply + persist it the
  // instant it's tapped (rather than only on Save, which is easy to miss), so
  // the choice can never be lost by closing the sheet. Merges onto the
  // last-saved profile so it doesn't disturb any in-progress numeric drafts, and
  // pushes to app state so every screen switches units immediately.
  const setUnits = async (u: Profile["units"]) => {
    if (u === p.units) return;
    set("units", u);
    // Instant-persist the preference ONLY onto a profile that already exists.
    // NEVER fabricate a DEFAULT profile here — writing DEFAULT_PROFILE would
    // overwrite the user's real stats whenever the profile hasn't loaded / isn't
    // set yet (the "all my stats reverted to default" bug). With no stored
    // profile, the local draft carries the choice into the explicit Save.
    if (!profile) return;
    try {
      const repo = await getRepository();
      const next: Profile = { ...profile, units: u };
      await repo.saveProfile(next);
      onSave(goals, next);
    } catch {
      /* best-effort — the Save button still persists everything */
    }
  };

  const applyRecommended = () => setG(recommendGoals(toProfile(p)));

  const save = async () => {
    setBusy(true);
    try {
      const fp = toProfile(p);
      const fg = toGoals(g);
      const repo = await getRepository();
      await repo.saveProfile(fp);
      if (plan) {
        const { plan: next, goals: ng } = await updatePlan(
          plan,
          {
            mode,
            goals: planGoals,
            targets: goalsToTargets(fg),
            ...(startDate && endDate
              ? { startDate, endDate, durationWeeks: weeksBetween(startDate, endDate) }
              : {}),
          },
          { currentGoals: fg },
        );
        onPlanChange(next);
        onSave(ng, fp);
      } else {
        await repo.saveGoals(fg);
        onSave(fg, fp);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // Sub-view: the workout-program editor is its own full overlay.
  if (view === "program" && plan?.program) {
    return (
      <ProgramEditor
        program={plan.program}
        mode={plan.mode}
        injuries={plan.safety.injuries ?? []}
        units={p.units}
        onCancel={() => setView("main")}
        onSave={async (updated) => {
          const next = await saveProgram(plan, updated);
          onPlanChange(next);
          setView("main");
        }}
      />
    );
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Profile &amp; plan</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </header>

        <div className="sheet-body">
          <div className="section-label">About you</div>
          <div className="form-grid">
            <Field label="Sex">
              <select className="select" value={p.sex} onChange={(e) => set("sex", e.target.value as Sex)}>
                {(Object.keys(SEX_OPTS) as Sex[]).map((s) => (
                  <option key={s} value={s}>{SEX_OPTS[s]}</option>
                ))}
              </select>
            </Field>
            <Field label="Age">
              <NumberField value={p.age} min={10} max={120} onChange={(n) => set("age", n)} aria-label="Age" />
            </Field>
            <HeightField
              units={p.units}
              heightCm={p.heightCm}
              onChange={(cm) => set("heightCm", cm)}
            />
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
                <button key={u} type="button" className={`chip${p.units === u ? " active" : ""}`} onClick={() => void setUnits(u)}>
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

          <GoalWeightField
            units={p.units}
            goalWeightKg={p.goalWeightKg}
            onChange={(kg) => set("goalWeightKg", kg)}
            optional
          />

          <Field label="Experience level">
            <select
              className="select"
              value={p.experienceLevel ?? "beginner"}
              onChange={(e) => set("experienceLevel", e.target.value as ExperienceLevel)}
            >
              {(Object.keys(EXPERIENCE_LABELS) as ExperienceLevel[]).map((k) => (
                <option key={k} value={k}>{EXPERIENCE_LABELS[k]}</option>
              ))}
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

          {plan && (
            <>
              <div className="section-label">Your plan</div>
              <Field label="Focus">
                <select className="select" value={mode} onChange={(e) => setMode(e.target.value as PlanMode)}>
                  {(Object.keys(PLAN_MODE_LABELS) as PlanMode[]).map((m) => (
                    <option key={m} value={m}>
                      {PLAN_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Field>

              {startDate && endDate && (
                <div className="field">
                  <span>Plan dates</span>
                  <PlanDatesField
                    startDate={startDate}
                    endDate={endDate}
                    onStart={setStartDate}
                    onEnd={setEndDate}
                  />
                </div>
              )}

              {planGoals.length > 0 && (
                <div className="field">
                  <span>Plan goals</span>
                  <div className="plan-goal-edit-list">
                    {planGoals.map((pg, i) => (
                      <div className="plan-goal-edit" key={pg.id}>
                        <span className={`goal-kind goal-${pg.kind}`}>{pg.kind}</span>
                        <input
                          className="text-input"
                          value={pg.label}
                          aria-label={`Plan goal ${i + 1}`}
                          onChange={(e) =>
                            setPlanGoals((prev) =>
                              prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)),
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {plan.program && (
                <button className="btn block" onClick={() => setView("program")}>
                  Edit workout program
                </button>
              )}

              <button className="btn block danger-subtle" onClick={onStartNewPlan}>
                Start a new plan
              </button>
              <div className="muted small">
                Rebuilds your goals &amp; workouts from the wizard. Your logged food, weight, and
                completed workouts are kept.
              </div>
            </>
          )}
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
