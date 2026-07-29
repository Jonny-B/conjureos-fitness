import { useEffect, useState, type ReactNode } from "react";
import type { Goals, Plan, Profile } from "../types";
import { DEFAULT_GOALS } from "../types";
import { getRepository } from "../data/repository";
import { goalsToTargets, saveProgram, targetsToGoals, updatePlan } from "../features/plan/planService";
import { ProgramEditor } from "../components/ProgramEditor";
import { NumberField } from "../components/NumberField";
import { CloseIcon } from "../components/icons";
import { useScrollLock } from "../hooks/useScrollLock";
import { clearAllHistories, clearHistory, HISTORY_ITEMS } from "../features/resetData";

/** Which surface the settings sheet opens on. "program" deep-links straight to
 *  the workout-program editor (e.g. from the Plan tab's "Edit workouts"). */
export type SettingsView = "main" | "program";

// While editing, the numeric fields may be empty (undefined). Coerced (clamped,
// defaulted) at save — see toGoals.
type GoalsDraft = { calories?: number; protein?: number; carbs?: number; fat?: number };

function clampNum(v: number | undefined, min: number, max: number, dflt: number): number {
  if (v == null || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.round(v)));
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
 * Settings (the cog) — now strictly "about your app", NOT a plan editor.
 *
 * Everything that authors a plan (goal, mode, dates, body stats, workouts) moved
 * to the single plan editor reached from the Plan tab's "Edit plan" (the wizard,
 * prefilled), so a change there re-derives your calorie target instead of the
 * old cog behaviour where editing goal weight never moved the ring. This sheet
 * keeps only: the units preference, an advanced manual override of the daily
 * targets, and the reset-health-data tools. The "program" sub-view (the workout
 * editor) is still hosted here and reached via "Edit workouts".
 */
export function SettingsSheet({
  goals,
  profile,
  plan,
  initialView = "main",
  onClose,
  onSave,
  onPlanChange,
  onDataCleared,
}: {
  goals: Goals;
  profile: Profile | null;
  plan: Plan | null;
  initialView?: SettingsView;
  onClose: () => void;
  onSave: (goals: Goals, profile: Profile) => void;
  onPlanChange: (plan: Plan) => void;
  /** Fired after any history clear so screens re-read their data. */
  onDataCleared?: () => void;
}) {
  const [units, setUnitsState] = useState<Profile["units"]>(profile?.units ?? "metric");
  // Manual target-override draft, seeded from what the plan/goals currently show.
  const [g, setG] = useState<GoalsDraft>(targetsToGoals(plan, goals));
  const [view, setView] = useState<SettingsView>(
    initialView === "program" && plan?.program ? "program" : "main",
  );
  const [busy, setBusy] = useState(false);
  // Both advanced/rare panels are collapsed by default so the sheet stays short.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  useScrollLock();

  // Units is a display preference — apply + persist it the instant it's tapped
  // (not only on Save, which is easy to miss), so the choice can never be lost
  // by closing the sheet. NEVER fabricate a DEFAULT profile here (that once
  // reverted real stats); with no stored profile the choice rides the next plan
  // edit's profile write instead.
  const setUnits = async (u: Profile["units"]) => {
    if (u === units) return;
    setUnitsState(u);
    if (!profile) return;
    try {
      const repo = await getRepository();
      const next: Profile = { ...profile, units: u };
      await repo.saveProfile(next);
      onSave(goals, next);
    } catch {
      /* best-effort — nothing else here persists units */
    }
  };

  // Persist a manual target override straight through to the plan (or Goals),
  // so the diary ring updates immediately via effectiveGoals.
  const saveOverride = async () => {
    setBusy(true);
    try {
      const fg = toGoals(g);
      const repo = await getRepository();
      if (plan) {
        const { plan: next, goals: ng } = await updatePlan(
          plan,
          { targets: goalsToTargets(fg) },
          { currentGoals: fg },
        );
        onPlanChange(next);
        onSave(ng, profile ?? ({ units } as Profile));
      } else {
        await repo.saveGoals(fg);
        onSave(fg, profile ?? ({ units } as Profile));
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // Sub-view: the workout-program editor ("Edit workouts") is its own overlay.
  if (view === "program" && plan?.program) {
    return (
      <ProgramEditor
        program={plan.program}
        mode={plan.mode}
        injuries={plan.safety.injuries ?? []}
        units={units}
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
          <h2>Settings</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </header>

        <div className="sheet-body">
          <Field label="Units">
            <div className="chip-row">
              {(["metric", "imperial"] as const).map((u) => (
                <button key={u} type="button" className={`chip${units === u ? " active" : ""}`} onClick={() => void setUnits(u)}>
                  {u === "metric" ? "Metric (kg, cm)" : "Imperial (lb, in)"}
                </button>
              ))}
            </div>
          </Field>
          <p className="muted small">
            Your stats, goals, dates and workouts now live in <strong>Edit plan</strong> on the Plan tab.
            Changing them there recalculates your daily targets.
          </p>

          <div className="section-label">Daily targets</div>
          <button className="btn block" onClick={() => setOverrideOpen((o) => !o)}>
            {overrideOpen ? "Hide manual override" : "Override daily targets (advanced)…"}
          </button>
          {overrideOpen && (
            <div className="reset-list">
              <p className="muted small">
                Set your own calorie &amp; macro targets. This overrides the value your plan computed,
                until your next plan edit recalculates it.
              </p>
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
              <button className="btn primary block" disabled={busy} onClick={() => void saveOverride()}>
                {busy ? "Saving…" : "Save targets"}
              </button>
            </div>
          )}

          <div className="section-label">Data</div>
          <button className="btn block" onClick={() => setResetOpen((o) => !o)}>
            {resetOpen ? "Hide reset options" : "Reset health data…"}
          </button>
          {resetOpen && (
            <div className="reset-list">
              <p className="muted small reset-warning">
                Clearing is permanent. Your profile, units, and current plan are kept.
              </p>
              {HISTORY_ITEMS.map((item) => (
                <ResetRow
                  key={item.kind}
                  label={item.label}
                  desc={item.desc}
                  onClear={async () => {
                    await clearHistory(item.kind);
                    onDataCleared?.();
                  }}
                />
              ))}
              <ResetRow
                label="Clear all history"
                desc="Everything above, in one go"
                danger
                onClear={async () => {
                  await clearAllHistories();
                  onDataCleared?.();
                }}
              />
            </div>
          )}
        </div>

        <footer className="sheet-foot">
          <button className="btn" onClick={onClose}>
            Done
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

/**
 * One history row in "Reset health data". Destructive, so the button arms on
 * the first tap ("Tap to confirm") and disarms itself after a few seconds —
 * no accidental single-tap wipes, no browser confirm() dialogs (unreliable in
 * the app WebView).
 */
function ResetRow({
  label,
  desc,
  danger = false,
  onClear,
}: {
  label: string;
  desc: string;
  danger?: boolean;
  onClear: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "armed" | "busy" | "done">("idle");

  useEffect(() => {
    if (state !== "armed") return;
    const t = setTimeout(() => setState("idle"), 3500);
    return () => clearTimeout(t);
  }, [state]);

  const click = async () => {
    if (state === "idle") {
      setState("armed");
      return;
    }
    if (state !== "armed") return;
    setState("busy");
    try {
      await onClear();
      setState("done");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("idle");
    }
  };

  return (
    <div className="reset-row">
      <div className="reset-row-text">
        <div className={`reset-row-label${danger ? " danger-text" : ""}`}>{label}</div>
        <div className="muted small">{desc}</div>
      </div>
      <button
        className={`btn reset-btn${state === "armed" || danger ? " danger" : ""}`}
        disabled={state === "busy"}
        onClick={() => void click()}
      >
        {state === "idle" ? "Clear" : state === "armed" ? "Tap to confirm" : state === "busy" ? "Clearing…" : "Cleared ✓"}
      </button>
    </div>
  );
}
