import { useEffect, useState, type ReactNode } from "react";
import type { Goals, Plan, Profile } from "../types";
import { getRepository } from "../data/repository";
import { saveProgram } from "../features/plan/planService";
import { ProgramEditor } from "../components/ProgramEditor";
import { CloseIcon } from "../components/icons";
import { useScrollLock } from "../hooks/useScrollLock";
import { clearAllHistories, clearHistory, visibleHistoryItems } from "../features/resetData";

/** Which surface the settings sheet opens on. "program" deep-links straight to
 *  the workout-program editor (e.g. from the Plan tab's "Edit workouts"). */
export type SettingsView = "main" | "program";

/**
 * Settings (the cog) — strictly "about your app", NOT a plan editor.
 *
 * Everything that authors a plan (goal, mode, dates, body stats, workouts) and
 * the manual daily-targets override live on the Plan tab now, so this sheet is
 * just the units preference + the reset-health-data tools. The "program" sub-
 * view (the workout editor) is still hosted here, reached via "Edit workouts".
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
  // The program sub-view (Edit workouts) is only ever entered directly via
  // initialView; the cog itself no longer links to it, so this never changes
  // after mount — closing the editor closes the whole sheet.
  const view: SettingsView = initialView === "program" && plan?.program ? "program" : "main";
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

  // Sub-view: the workout-program editor ("Edit workouts") is its own overlay.
  if (view === "program" && plan?.program) {
    return (
      <ProgramEditor
        program={plan.program}
        mode={plan.mode}
        injuries={plan.safety.injuries ?? []}
        units={units}
        onCancel={onClose}
        onSave={async (updated) => {
          const next = await saveProgram(plan, updated);
          onPlanChange(next);
          onClose();
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
            Your stats, goals, dates, workouts and daily targets live in{" "}
            <strong>Edit plan</strong> on the Plan tab. Changing them there recalculates your targets.
          </p>

          {/* Reset shown inline (no expand-in-place): the sheet is bottom-anchored,
              so a growing dropdown pushed the whole sheet up — jarring. */}
          <div className="section-label">Reset health data</div>
          <div className="reset-list">
            <p className="muted small reset-warning">
              Clearing is permanent. Your profile and units are kept.
            </p>
            {visibleHistoryItems().map((item) => (
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

  // Both transient states fall back to idle on their own: "armed" disarms if the
  // user walks away without confirming, "done" clears the confirmation tick.
  // Driving them from one effect means the timer is always cleaned up on
  // unmount, and re-clicking mid-countdown restarts it rather than stacking.
  useEffect(() => {
    if (state !== "armed" && state !== "done") return;
    const t = window.setTimeout(() => setState("idle"), state === "armed" ? 3500 : 2000);
    return () => window.clearTimeout(t);
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
      setState("done"); // the effect above returns it to idle
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
