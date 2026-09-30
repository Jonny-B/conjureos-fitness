import { useEffect, useState, type ReactNode } from "react";
import type { Plan, Profile } from "../types";
import { getRepository } from "../data/repository";
import { saveProgram } from "../features/plan/planService";
import { ProgramEditor } from "../components/ProgramEditor";
import { CloseIcon } from "../components/icons";
import { useScrollLock } from "../hooks/useScrollLock";
import { clearAllHistories, clearHistory, HISTORY_ITEMS } from "../features/resetData";
import { HealthDataPolicy } from "../components/HealthDataPolicy";

/** Which surface the settings sheet opens on. "program" deep-links straight to
 *  the workout-program editor (e.g. from the Plan tab's "Edit workouts"). */
export type SettingsView = "main" | "program";

/**
 * Persist a units change onto the STORED profile. App's cached profile can be
 * stale, and spreading it would write old values back over newer ones. Re-read
 * first; the prop is only a fallback if nothing is stored.
 */
export async function saveProfileUnits(units: Profile["units"], fallback: Profile): Promise<Profile> {
  const repo = await getRepository();
  const base = (await repo.getProfile()) ?? fallback;
  const next: Profile = { ...base, units };
  await repo.saveProfile(next);
  return next;
}

/**
 * Settings (the cog) — strictly "about your app", NOT a plan editor.
 *
 * Everything that authors a plan (goal, dates, body stats, workouts) lives on
 * the Plan tab, so this sheet is just the units preference, the privacy notice
 * and the reset tools. The "program" sub-view (the workout editor) is still
 * hosted here, reached via "Edit workouts".
 */
export function SettingsSheet({
  profile,
  plan,
  initialView = "main",
  onClose,
  onProfileChange,
  onPlanChange,
  onDataCleared,
  pendingUnits = "metric",
  onPendingUnits,
}: {
  profile: Profile | null;
  plan: Plan | null;
  initialView?: SettingsView;
  onClose: () => void;
  onProfileChange: (profile: Profile) => void;
  onPlanChange: (plan: Plan) => void;
  /** Fired after any history clear so screens re-read their data. */
  onDataCleared?: () => void;
  /** Units picked while there is no profile yet (held in App, seeds the wizard). */
  pendingUnits?: Profile["units"];
  onPendingUnits?: (units: Profile["units"]) => void;
}) {
  const [units, setUnitsState] = useState<Profile["units"]>(profile?.units ?? pendingUnits);
  // The program sub-view (Edit workouts) is only ever entered directly via
  // initialView; the cog itself no longer links to it, so this never changes
  // after mount — closing the editor closes the whole sheet.
  const view: SettingsView = initialView === "program" && plan?.program ? "program" : "main";
  const [policyOpen, setPolicyOpen] = useState(false);
  useScrollLock();

  // Units is a display preference — apply + persist it the instant it's tapped
  // (not only on Save, which is easy to miss), so the choice can never be lost
  // by closing the sheet. NEVER fabricate a DEFAULT profile here (that once
  // reverted real stats); with no stored profile the choice is kept in App
  // (pendingUnits), which seeds the wizard so the first plan's write carries it.
  const setUnits = async (u: Profile["units"]) => {
    if (u === units) return;
    setUnitsState(u);
    if (!profile) {
      onPendingUnits?.(u);
      return;
    }
    try {
      const next = await saveProfileUnits(u, profile);
      onProfileChange(next);
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
                  {u === "metric" ? "Metric (kg, km)" : "Imperial (lb, mi)"}
                </button>
              ))}
            </div>
          </Field>
          <p className="muted small">
            Your goal, dates, stats and workouts live in <strong>Edit plan</strong> on the Plan tab.
          </p>

          <div className="section-label">Privacy</div>
          <div className="privacy-block">
            <p className="muted small">
              Your workouts, routes and plan stay on your device and in your ConjureOS account.
              Building a plan, the coach and calorie-burn estimates send what they need to the AI
              through ConjureOS.
            </p>
            <button className="btn small ghost" onClick={() => setPolicyOpen(true)}>
              Consumer Health Data Privacy
            </button>
          </div>

          {/* Reset shown inline (no expand-in-place): the sheet is bottom-anchored,
              so a growing dropdown pushed the whole sheet up — jarring. */}
          <div className="section-label">Reset data</div>
          <div className="reset-list">
            <p className="muted small reset-warning">
              Clearing is permanent. Your profile and units are kept.
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
        </div>

        <footer className="sheet-foot">
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
      {policyOpen && <HealthDataPolicy onClose={() => setPolicyOpen(false)} />}
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
 * One history row in "Reset data". Destructive, so the button arms on
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
