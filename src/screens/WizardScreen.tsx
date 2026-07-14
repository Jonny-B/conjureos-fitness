import { useState } from "react";
import type {
  ActivityLevel,
  AgeBand,
  ExperienceLevel,
  GoalDirection,
  Plan,
  PlanMode,
  Profile,
  SafetyIntake,
  Sex,
} from "../types";
import { INJURY_REGIONS } from "../features/safety/injuryExclusions";
import { requiresLoggingOnly, resolveSafeMode } from "../features/safety/intakeGate";
import { recommendGoals } from "../features/goals";
import { shiftDate, todayISO } from "../features/diary";
import { DisclaimerCard, DISCLAIMER_SHORT } from "../components/DisclaimerCard";
import { ProgramEditor } from "../components/ProgramEditor";
import {
  ActivityField,
  AgeField,
  BodyStatsFields,
  DirectionField,
  ExperienceField,
  GoalWeightField,
  PlanDatesField,
  SexField,
  weeksBetween,
} from "../components/PlanFields";
import { AlertTriangle, CheckIcon, CloseIcon } from "../components/icons";
import { createPlan, type CreatePlanResult, type PlanStage } from "../features/plan/generate";
import type { PlanInput } from "../features/plan/model";
import { modeHasWorkouts, modeTracksFood } from "../features/plan/model";
import type { WizardBody } from "../features/plan/planService";
import type { ExerciseSet, ProgramWorkout } from "../types";

type Step = "disclaimer" | "mode" | "safety" | "inputs" | "review";

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

interface Props {
  onComplete: (plan: Plan, body: WizardBody) => void;
  onClose?: () => void;
  units?: Profile["units"];
}

const MODE_CARDS: { mode: PlanMode; title: string; blurb: string; recommended?: boolean }[] = [
  { mode: "eat_better", title: "Eat better", blurb: "Nutrition only — calories, protein, habits." },
  { mode: "both", title: "Both", blurb: "Food and movement together.", recommended: true },
  { mode: "get_fit", title: "Get fit", blurb: "Movement only — short, guided sessions." },
];

const STAGE_LABELS: Record<PlanStage, string> = {
  calories: "Calculating your calories…",
  workouts: "Building your workouts…",
  checking: "Checking it's safe for you…",
};

function ageToBand(age: number): AgeBand {
  if (age < 18) return "under_18";
  if (age <= 39) return "18_39";
  if (age <= 59) return "40_59";
  return "60_plus";
}

/** Terse "3 × 10" / "4 × 30s" summary of an exercise's sets for the review list. */
function setSummary(sets: ExerciseSet[]): string {
  if (!sets.length) return "";
  const s = sets[0]!;
  const per = s.durationSec != null ? `${s.durationSec}s` : s.reps != null ? `${s.reps}` : "";
  return per ? `${sets.length} × ${per}` : `${sets.length} sets`;
}

export function WizardScreen({ onComplete, onClose, units = "metric" }: Props) {
  const [step, setStep] = useState<Step>("disclaimer");

  // Step 1
  const [mode, setMode] = useState<PlanMode>("both");
  // Step 2 (safety intake) — age is a number now; the band is derived.
  const [age, setAge] = useState<number | undefined>(30);
  const [pregnant, setPregnant] = useState(false);
  const [cardiacFlag, setCardiacFlag] = useState(false);
  const [injuries, setInjuries] = useState<Set<string>>(new Set());
  // Step 3 (inputs)
  const [goalText, setGoalText] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(shiftDate(todayISO(), 13)); // ~2 weeks
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("beginner");
  const [equipment, setEquipment] = useState("");
  const [unitPref, setUnitPref] = useState<Profile["units"]>(units);
  const [heightCm, setHeightCm] = useState<number | undefined>(undefined);
  const [weightKg, setWeightKg] = useState<number | undefined>(undefined);
  const [goalWeightKg, setGoalWeightKg] = useState<number | undefined>(undefined);
  const [sex, setSex] = useState<Sex>("female");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("moderate");
  const [direction, setDirection] = useState<GoalDirection>("maintain");
  // Step 4 (review)
  const [preview, setPreview] = useState<CreatePlanResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [stage, setStage] = useState<PlanStage | null>(null);
  const [tweakOpen, setTweakOpen] = useState(false);
  const [tweakText, setTweakText] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const ageBand = ageToBand(age ?? 30);
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

  /** Calorie target computed from the profile (Mifflin) — the app owns this, so
   *  a plan is never rejected just because the AI omitted the number. */
  const localCalorieTarget = (): number | null => {
    if (!tracksFood || heightCm == null || weightKg == null) return null;
    const p: Profile = {
      sex,
      age: age ?? 30,
      heightCm,
      weightKg,
      activityLevel,
      direction,
      units: unitPref,
    };
    return recommendGoals(p).calories;
  };

  const buildInput = (extraGoal = ""): PlanInput => ({
    mode: effectiveMode,
    goalText: [goalText, extraGoal].filter(Boolean).join(". Also: "),
    durationWeeks: weeksBetween(startDate, endDate),
    startDate,
    endDate,
    daysPerWeek: hasWorkouts ? daysPerWeek : undefined,
    experienceLevel: hasWorkouts ? experienceLevel : undefined,
    equipment: hasWorkouts ? equipment : undefined,
    heightCm: tracksFood ? heightCm : undefined,
    weightKg: tracksFood ? weightKg : undefined,
    goalWeightKg: tracksFood && direction !== "maintain" ? goalWeightKg : undefined,
    age: tracksFood ? age : undefined,
    sex: tracksFood ? sex : undefined,
    calorieTarget: localCalorieTarget(),
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

  const PLACEHOLDER_ACK = { acknowledged: false, acceptedAt: "" };

  const runPreview = async (extraGoal = "") => {
    setPreviewLoading(true);
    setPreview(null);
    setStage("calories");
    try {
      const result = await createPlan(buildInput(extraGoal), PLACEHOLDER_ACK, { onStage: setStage });
      setPreview(result);
    } finally {
      setPreviewLoading(false);
      setStage(null);
    }
  };

  const goReview = () => {
    setStep("review");
    void runPreview();
  };

  const inputsValid = tracksFood ? heightCm != null && weightKg != null : true;

  const start = () => {
    if (!preview) return;
    const plan: Plan = {
      ...preview.plan,
      liability: { acknowledged: true, acceptedAt: new Date().toISOString(), appVersion: APP_VERSION },
    };
    const body: WizardBody = {
      sex: tracksFood ? sex : undefined,
      heightCm: tracksFood ? heightCm : undefined,
      weightKg: tracksFood ? weightKg : undefined,
      goalWeightKg: tracksFood && direction !== "maintain" ? goalWeightKg : undefined,
      age,
      ageBand,
      activityLevel,
      experienceLevel: hasWorkouts ? experienceLevel : undefined,
      direction: tracksFood ? direction : undefined,
      units: unitPref,
    };
    onComplete(plan, body);
  };

  return (
    <div className="wizard">
      {onClose && (
        <div className="wizard-top">
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </div>
      )}
      {step === "disclaimer" && <DisclaimerCard onAccept={() => setStep("mode")} />}

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

          <AgeField age={age} onChange={setAge} />

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
              placeholder="e.g. lose a few pounds and get better at the Murph"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
            />
          </label>

          <PlanDatesField startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} hideStart />

          {hasWorkouts && (
            <>
              <label className="field">
                <span className="field-label">Workout days per week: {daysPerWeek}</span>
                <input type="range" min={1} max={6} value={daysPerWeek} onChange={(e) => setDaysPerWeek(Number(e.target.value))} />
              </label>
              <ExperienceField value={experienceLevel} onChange={setExperienceLevel} />
              <label className="field">
                <span className="field-label">Equipment (optional)</span>
                <input
                  className="text-input"
                  placeholder="none / dumbbells / pull-up bar…"
                  value={equipment}
                  onChange={(e) => setEquipment(e.target.value)}
                />
              </label>
            </>
          )}

          {tracksFood && (
            <>
              <BodyStatsFields
                units={unitPref}
                heightCm={heightCm}
                weightKg={weightKg}
                onUnits={setUnitPref}
                onHeightCm={setHeightCm}
                onWeightKg={setWeightKg}
              />
              <SexField sex={sex} onChange={setSex} />
              <ActivityField value={activityLevel} onChange={setActivityLevel} />
              <DirectionField value={direction} onChange={setDirection} />
              {direction !== "maintain" && (
                <GoalWeightField units={unitPref} goalWeightKg={goalWeightKg} onChange={setGoalWeightKg} />
              )}
            </>
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
              <p className="muted small">{stage ? STAGE_LABELS[stage] : "Putting your plan together…"}</p>
            </div>
          ) : (
            <>
              {preview.usedFallback && (
                <div className="notice notice-soft">
                  <span>We used a safe starter plan for now — tweak it or regenerate any time.</span>
                  {preview.failureReason && (
                    <div className="muted small">Why the AI didn't generate one: {preview.failureReason}</div>
                  )}
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

              {preview.plan.program && preview.plan.program.workouts.length > 0 && (
                <div className="plan-workouts">
                  <div className="section-label">Your workouts</div>
                  {preview.plan.program.workouts.map((pw: ProgramWorkout) => (
                    <div className="plan-workout" key={pw.id}>
                      <div className="plan-workout-name">{pw.workout.name}</div>
                      <ul className="plan-exercise-list">
                        {pw.workout.exercises.map((e) => (
                          <li key={e.id}>
                            <span className="pe-name">{e.name}</span>
                            <span className="pe-sets">{setSummary(e.sets)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {tweakOpen && (
                <label className="field">
                  <span className="field-label">What should change?</span>
                  <input
                    className="text-input"
                    placeholder="e.g. more running, add a rest day"
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
                {!tweakOpen && <button className="btn" onClick={() => setTweakOpen(true)}>Tweak it</button>}
                {preview.plan.program && (
                  <button className="btn" onClick={() => setEditOpen(true)}>Edit workouts</button>
                )}
                <button className="btn primary" onClick={start}>
                  <CheckIcon size={16} /> Start the plan
                </button>
              </div>

              {editOpen && preview.plan.program && (
                <ProgramEditor
                  program={preview.plan.program}
                  mode={preview.plan.mode}
                  injuries={intake.injuries}
                  units={unitPref}
                  onCancel={() => setEditOpen(false)}
                  onSave={(updated) => {
                    setPreview((prev) => (prev ? { ...prev, plan: { ...prev.plan, program: updated } } : prev));
                    setEditOpen(false);
                  }}
                />
              )}
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
