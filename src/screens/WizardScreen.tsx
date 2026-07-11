import { useState } from "react";
import type { AgeBand, ActivityLevel, Plan, PlanMode, SafetyIntake, Sex } from "../types";
import { INJURY_REGIONS } from "../features/safety/injuryExclusions";
import { requiresLoggingOnly, resolveSafeMode } from "../features/safety/intakeGate";
import { DisclaimerCard, DISCLAIMER_SHORT } from "../components/DisclaimerCard";
import { AlertTriangle, CheckIcon } from "../components/icons";
import { createPlan, type CreatePlanResult } from "../features/plan/generate";
import type { PlanInput } from "../features/plan/model";
import { modeHasWorkouts, modeTracksFood } from "../features/plan/model";

type Step = "disclaimer" | "mode" | "safety" | "inputs" | "review";

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

interface Props {
  /** Fired with the saved-ready Plan when the user taps "Start the plan". */
  onComplete: (plan: Plan) => void;
}

const MODE_CARDS: { mode: PlanMode; title: string; blurb: string; recommended?: boolean }[] = [
  { mode: "eat_better", title: "Eat better", blurb: "Nutrition only — calories, protein, habits." },
  { mode: "both", title: "Both", blurb: "Food and movement together.", recommended: true },
  { mode: "get_fit", title: "Get fit", blurb: "Movement only — short, guided sessions." },
];

const AGE_BANDS: { id: AgeBand; label: string }[] = [
  { id: "under_18", label: "Under 18" },
  { id: "18_39", label: "18–39" },
  { id: "40_59", label: "40–59" },
  { id: "60_plus", label: "60+" },
];

const DURATIONS: { weeks: number; label: string }[] = [
  { weeks: 1, label: "1 week" },
  { weeks: 2, label: "2 weeks" },
  { weeks: 3, label: "3 weeks" },
  { weeks: 4, label: "1 month" },
];

export function WizardScreen({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("disclaimer");

  // Step 1
  const [mode, setMode] = useState<PlanMode>("both");
  // Step 2 (safety intake)
  const [ageBand, setAgeBand] = useState<AgeBand>("18_39");
  const [pregnant, setPregnant] = useState(false);
  const [cardiacFlag, setCardiacFlag] = useState(false);
  const [injuries, setInjuries] = useState<Set<string>>(new Set());
  // Activity level isn't asked yet (keeps the intake short); default to light.
  const activityLevel: ActivityLevel = "light";
  // Step 3 (inputs)
  const [goalText, setGoalText] = useState("");
  const [durationWeeks, setDurationWeeks] = useState(2);
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [equipment, setEquipment] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [sex, setSex] = useState<Sex>("female");
  // Step 4 (review)
  const [preview, setPreview] = useState<CreatePlanResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [tweakOpen, setTweakOpen] = useState(false);
  const [tweakText, setTweakText] = useState("");

  const intake: SafetyIntake = {
    ageBand,
    pregnant,
    cardiacFlag,
    injuries: [...injuries],
    activityLevel,
  };
  const gated = requiresLoggingOnly(intake);
  const effectiveMode = resolveSafeMode(mode, intake);
  const tracksFood = modeTracksFood(effectiveMode);
  const hasWorkouts = modeHasWorkouts(effectiveMode);

  const buildInput = (extraGoal = ""): PlanInput => ({
    mode: effectiveMode,
    goalText: [goalText, extraGoal].filter(Boolean).join(". Also: "),
    durationWeeks,
    daysPerWeek: hasWorkouts ? daysPerWeek : undefined,
    equipment: hasWorkouts ? equipment : undefined,
    heightCm: tracksFood && heightCm ? Number(heightCm) : undefined,
    weightKg: tracksFood && weightKg ? Number(weightKg) : undefined,
    sex: tracksFood ? sex : undefined,
    safety: intake,
  });

  const toggleInjury = (id: string) => {
    setInjuries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // A preview plan is generated with a placeholder ack; the real liability
  // timestamp is stamped only when the user taps "Start the plan".
  const PLACEHOLDER_ACK = { acknowledged: false, acceptedAt: "" };

  const runPreview = async (extraGoal = "") => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const result = await createPlan(buildInput(extraGoal), PLACEHOLDER_ACK);
      setPreview(result);
    } finally {
      setPreviewLoading(false);
    }
  };

  const goReview = () => {
    setStep("review");
    void runPreview();
  };

  const inputsValid = tracksFood ? Number(heightCm) > 0 && Number(weightKg) > 0 : true;

  const start = () => {
    if (!preview) return;
    const plan: Plan = {
      ...preview.plan,
      liability: {
        acknowledged: true,
        acceptedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
      },
    };
    onComplete(plan);
  };

  return (
    <div className="wizard">
      {step === "disclaimer" && (
        <DisclaimerCard onAccept={() => setStep("mode")} />
      )}

      {step === "mode" && (
        <div className="mode-body wizard-step">
          <WizardHead n={1} title="What do you want to focus on?" />
          <div className="mode-cards">
            {MODE_CARDS.map((c) => (
              <button
                key={c.mode}
                className={`mode-card${mode === c.mode ? " active" : ""}`}
                onClick={() => setMode(c.mode)}
              >
                <span className="mode-card-title">
                  {c.title}
                  {c.recommended && <span className="mode-card-badge">Recommended</span>}
                </span>
                <span className="mode-card-blurb">{c.blurb}</span>
              </button>
            ))}
          </div>
          <div className="wizard-nav">
            <button className="btn primary block" onClick={() => setStep("safety")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "safety" && (
        <div className="mode-body wizard-step">
          <WizardHead n={2} title="A quick safety check" />
          <p className="muted small">This keeps your plan appropriate. Nothing leaves your device.</p>

          <label className="field">
            <span className="field-label">Age</span>
            <select className="select" value={ageBand} onChange={(e) => setAgeBand(e.target.value as AgeBand)}>
              {AGE_BANDS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>

          <label className="check-row">
            <input type="checkbox" checked={pregnant} onChange={(e) => setPregnant(e.target.checked)} />
            <span>Pregnant or recently postpartum</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={cardiacFlag} onChange={(e) => setCardiacFlag(e.target.checked)} />
            <span>A heart condition, or a doctor has told me to be careful with exercise</span>
          </label>

          <div className="field">
            <span className="field-label">Any injuries to work around?</span>
            <div className="chip-row">
              {INJURY_REGIONS.map((r) => (
                <button
                  key={r.id}
                  className={`chip${injuries.has(r.id) ? " active" : ""}`}
                  onClick={() => toggleInjury(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {gated && (
            <div className="notice notice-soft">
              <AlertTriangle />
              <span>Based on your answers we'll keep this to food &amp; habit tracking — no workout prescriptions. You can always talk to your doctor about adding exercise.</span>
            </div>
          )}

          <div className="wizard-nav">
            <button className="btn" onClick={() => setStep("mode")}>Back</button>
            <button className="btn primary" onClick={() => setStep("inputs")}>Continue</button>
          </div>
        </div>
      )}

      {step === "inputs" && (
        <div className="mode-body wizard-step">
          <WizardHead n={3} title="Tell us a little more" />

          <label className="field">
            <span className="field-label">What's your goal, in your words?</span>
            <textarea
              className="text-area"
              rows={2}
              placeholder="e.g. lose a few pounds and feel less winded on the stairs"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
            />
          </label>

          <div className="field">
            <span className="field-label">How long?</span>
            <div className="chip-row">
              {DURATIONS.map((d) => (
                <button
                  key={d.weeks}
                  className={`chip${durationWeeks === d.weeks ? " active" : ""}`}
                  onClick={() => setDurationWeeks(d.weeks)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {hasWorkouts && (
            <>
              <label className="field">
                <span className="field-label">Workout days per week: {daysPerWeek}</span>
                <input
                  type="range"
                  min={1}
                  max={6}
                  value={daysPerWeek}
                  onChange={(e) => setDaysPerWeek(Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">Equipment (optional)</span>
                <input
                  className="text-input"
                  placeholder="none / dumbbells / resistance band…"
                  value={equipment}
                  onChange={(e) => setEquipment(e.target.value)}
                />
              </label>
            </>
          )}

          {tracksFood && (
            <div className="row gap">
              <label className="field">
                <span className="field-label">Height (cm)</span>
                <input className="text-input" inputMode="numeric" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Weight (kg)</span>
                <input className="text-input" inputMode="numeric" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Sex</span>
                <select className="select" value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </label>
            </div>
          )}

          <div className="wizard-nav">
            <button className="btn" onClick={() => setStep("safety")}>Back</button>
            <button className="btn primary" disabled={!inputsValid} onClick={goReview}>
              Build my plan
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="mode-body wizard-step">
          <WizardHead n={4} title="Here's your plan" />

          {previewLoading || !preview ? (
            <div className="center-fill">
              <div className="spinner" />
              <p className="muted small">Putting your plan together…</p>
            </div>
          ) : (
            <>
              {preview.usedFallback && (
                <div className="notice notice-soft">
                  <span>We used a safe starter plan for now — you can refine it any time.</span>
                </div>
              )}
              <p className="plan-summary">{preview.gen.summary}</p>
              <ul className="plan-goal-list">
                {preview.gen.goals.map((g, i) => (
                  <li className="plan-goal" key={i}>
                    <span className={`goal-kind goal-${g.kind}`}>{g.kind}</span>
                    <span className="goal-label">{g.label}</span>
                  </li>
                ))}
              </ul>

              {tweakOpen && (
                <label className="field">
                  <span className="field-label">What should change?</span>
                  <input
                    className="text-input"
                    placeholder="e.g. more walking, less time in the kitchen"
                    value={tweakText}
                    onChange={(e) => setTweakText(e.target.value)}
                  />
                  <button
                    className="btn block"
                    onClick={() => {
                      setTweakOpen(false);
                      void runPreview(tweakText.trim());
                      setTweakText("");
                    }}
                  >
                    Regenerate
                  </button>
                </label>
              )}

              <div className="notice notice-soft disclaimer-inline">
                <AlertTriangle />
                <span>{DISCLAIMER_SHORT}</span>
              </div>

              <div className="wizard-nav">
                {!tweakOpen && (
                  <button className="btn" onClick={() => setTweakOpen(true)}>Tweak it</button>
                )}
                <button className="btn primary" onClick={start}>
                  <CheckIcon size={16} /> Start the plan
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function WizardHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="wizard-head">
      <span className="wizard-step-num">Step {n} of 4</span>
      <h1>{title}</h1>
    </div>
  );
}
