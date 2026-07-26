import { useEffect, useRef, useState } from "react";
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
import { activityForDaysPerWeek, deriveDirection, recommendGoals } from "../features/goals";
import { fmtSeconds } from "../features/units";
import { shiftDate, todayISO } from "../features/diary";
import { DisclaimerCard, DISCLAIMER_SHORT } from "../components/DisclaimerCard";
import { ProgramEditor } from "../components/ProgramEditor";
import {
  AgeField,
  BodyStatsFields,
  GoalWeightField,
  PlanDatesField,
  SexField,
  weeksBetween,
} from "../components/PlanFields";
import { AlertTriangle, CheckIcon, CloseIcon } from "../components/icons";
import { createPlan, regenerateProgram, type CreatePlanResult, type PlanStage } from "../features/plan/generate";
import { getRepository } from "../data/repository";
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
  /**
   * The user's existing profile, if they've already entered body stats via the
   * cog (or a prior plan). The wizard PREFILLS from it so those metrics aren't
   * re-typed — and, critically, aren't overwritten on commit: without prefill
   * the wizard's hardcoded defaults (female/30/…) would clobber real cog data
   * when `commitNewPlan` merges `body.sex ?? base.sex`.
   */
  profile?: Profile | null;
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

/** Terse "3 × 10" / "4 × 30s" / "1 × 8:00" summary of an exercise's sets. */
function setSummary(sets: ExerciseSet[]): string {
  if (!sets.length) return "";
  const s = sets[0]!;
  const per = s.durationSec != null ? fmtSeconds(s.durationSec) : s.reps != null ? `${s.reps}` : "";
  return per ? `${sets.length} × ${per}` : `${sets.length} sets`;
}

const DAYS_OPTIONS = [2, 3, 4, 5, 6] as const;
const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];
const EATER_ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "Mostly sitting" },
  { value: "light", label: "Lightly active" },
  { value: "moderate", label: "Moderately active" },
  { value: "active", label: "Very active" },
];

export function WizardScreen({ onComplete, onClose, units = "metric", profile }: Props) {
  const [step, setStep] = useState<Step>("disclaimer");

  // Step 1
  const [mode, setMode] = useState<PlanMode>("both");
  // Step 2 (safety intake) — age is a number now; the band is derived.
  // Prefill every body-stat field from the existing profile so nothing entered
  // in the cog is lost or re-typed; fall back to the same defaults as before
  // when there's no profile yet.
  const [age, setAge] = useState<number | undefined>(profile?.age ?? 30);
  const [pregnant, setPregnant] = useState(false);
  const [cardiacFlag, setCardiacFlag] = useState(false);
  const [injuries, setInjuries] = useState<Set<string>>(new Set());
  // Step 3 (inputs)
  const [goalText, setGoalText] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(shiftDate(todayISO(), 13)); // ~2 weeks
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(profile?.experienceLevel ?? "beginner");
  const [equipment, setEquipment] = useState("");
  const [unitPref, setUnitPref] = useState<Profile["units"]>(profile?.units ?? units);
  const [heightCm, setHeightCm] = useState<number | undefined>(profile?.heightCm);
  const [weightKg, setWeightKg] = useState<number | undefined>(profile?.weightKg);
  const [goalWeightKg, setGoalWeightKg] = useState<number | undefined>(profile?.goalWeightKg);
  const [sex, setSex] = useState<Sex>(profile?.sex ?? "female");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(profile?.activityLevel ?? "moderate");
  // No lose/maintain/gain selector — the goal weight vs current weight already
  // says it. Below = lose, above = gain, blank/equal = maintain.
  const direction: GoalDirection = deriveDirection(weightKg, goalWeightKg);
  // The user's current weight is best represented by their latest weigh-in (a
  // real measurement) over the profile's stored number, so seed from it when
  // present — but never stomp a value the user has already typed in the wizard.
  const weightTouched = useRef(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const repo = await getRepository();
      const ws = await repo.listWeights();
      if (alive && ws.length && !weightTouched.current) setWeightKg(ws[0]!.weightKg);
    })();
    return () => {
      alive = false;
    };
  }, []);
  // Step 4 (review)
  const [preview, setPreview] = useState<CreatePlanResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [stage, setStage] = useState<PlanStage | null>(null);
  const [tweakOpen, setTweakOpen] = useState(false);
  const [tweakText, setTweakText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  // "Rebuild workouts" (program-only retry when the goals are AI but the
  // workouts fell back to the starter template).
  const [rebuilding, setRebuilding] = useState(false);

  const rebuildWorkouts = async () => {
    if (!preview || rebuilding) return;
    setRebuilding(true);
    try {
      const res = await regenerateProgram(buildInput(), preview.gen.goals, [...injuries]);
      if (res.program) {
        setPreview((prev) =>
          prev
            ? {
                ...prev,
                programFallback: false,
                programFallbackReason: undefined,
                gen: { ...prev.gen, program: res.program! },
                plan: { ...prev.plan, program: res.program! },
              }
            : prev,
        );
      } else {
        setPreview((prev) => (prev ? { ...prev, programFallbackReason: res.reason } : prev));
      }
    } finally {
      setRebuilding(false);
    }
  };

  const ageBand = ageToBand(age ?? 30);
  // Activity is DERIVED from training days for workout modes — asking "how
  // active are you" next to "how many days will you train" was a duplicate.
  // The explicit chips remain only for food-only plans (no days/week there).
  const effectiveActivity: ActivityLevel =
    mode === "eat_better" ? activityLevel : activityForDaysPerWeek(daysPerWeek);
  const intake: SafetyIntake = {
    ageBand,
    pregnant,
    cardiacFlag,
    injuries: [...injuries],
    activityLevel: effectiveActivity,
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
      activityLevel: effectiveActivity,
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
    units: unitPref,
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
      activityLevel: effectiveActivity,
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

          <label className="field goal-describe">
            <span className="field-label">Describe it in your own words (optional)</span>
            <textarea
              className="text-area"
              rows={2}
              placeholder="e.g. lose a few pounds and get better at the Murph"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
            />
            <span className="muted small field-hint">
              The more specific you are, the better your plan and benchmark fit.
            </span>
          </label>

          <div className="wizard-nav">
            <button className="btn primary block" onClick={() => setStep("safety")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "safety" && (
        <div className="mode-body wizard-step">
          <WizardHead n={2} title="About you" />
          <p className="muted small">
            Everything about your body in one place. Nothing leaves your device.
          </p>

          <div className="form-grid">
            <AgeField age={age} onChange={setAge} />
            <SexField sex={sex} onChange={setSex} />
          </div>

          {tracksFood && (
            <>
              <BodyStatsFields
                units={unitPref}
                heightCm={heightCm}
                weightKg={weightKg}
                onUnits={setUnitPref}
                onHeightCm={setHeightCm}
                onWeightKg={(kg) => {
                  weightTouched.current = true;
                  setWeightKg(kg);
                }}
              />
              <GoalWeightField
                units={unitPref}
                goalWeightKg={goalWeightKg}
                onChange={setGoalWeightKg}
                optional
              />
            </>
          )}

          <div className="section-label">Safety check</div>
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
              <span>Based on your answers we'll keep this to food &amp; habit tracking, with no workout prescriptions. You can always talk to your doctor about adding exercise.</span>
            </div>
          )}

          <div className="wizard-nav">
            <button className="btn" onClick={() => setStep("mode")}>Back</button>
            <button className="btn primary" disabled={!inputsValid} onClick={() => setStep("inputs")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "inputs" && (
        <div className="mode-body wizard-step">
          <WizardHead n={3} title="Your training" />

          <PlanDatesField startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} hideStart />

          {hasWorkouts && (
            <>
              <div className="field">
                <span className="field-label">Workout days per week</span>
                <div className="chip-row">
                  {DAYS_OPTIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`chip${daysPerWeek === d ? " active" : ""}`}
                      onClick={() => setDaysPerWeek(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">Experience level</span>
                <div className="chip-row">
                  {EXPERIENCE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={`chip${experienceLevel === o.value ? " active" : ""}`}
                      onClick={() => setExperienceLevel(o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
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

          {!hasWorkouts && (
            <div className="field">
              <span className="field-label">How active is a typical day?</span>
              <div className="chip-row">
                {EATER_ACTIVITY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`chip${activityLevel === o.value ? " active" : ""}`}
                    onClick={() => setActivityLevel(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <span className="muted small field-hint">Used only to estimate your daily calories.</span>
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
              {!preview.usedFallback && preview.programFallback && (
                <div className="notice notice-soft">
                  <span>
                    Your goals are custom, but the workout builder hit a snag — these are STARTER
                    workouts, not tuned to your goal yet.
                  </span>
                  {preview.programFallbackReason && (
                    <div className="muted small">Why: {preview.programFallbackReason}</div>
                  )}
                  <button className="btn block" disabled={rebuilding} onClick={() => void rebuildWorkouts()}>
                    {rebuilding ? "Rebuilding workouts…" : "Rebuild workouts"}
                  </button>
                </div>
              )}
              <p className="plan-summary">{preview.gen.summary}</p>

              {tracksFood && preview.plan.targets?.dailyCalories != null && (
                <div className="calorie-callout">
                  <div className="calorie-callout-num">
                    <span className="big-number">{Math.round(preview.plan.targets.dailyCalories)}</span>
                    <span className="big-unit">kcal / day</span>
                  </div>
                  <span className="muted small">
                    Your daily calorie target, computed from your stats and goal weight. This is
                    what the ring on your home screen tracks.
                  </span>
                </div>
              )}

              {preview.plan.program && preview.plan.program.workouts.length > 0 && (
                <div className="plan-workouts">
                  {(() => {
                    const all = preview.plan.program!.workouts as ProgramWorkout[];
                    const evals = all.filter((pw) => pw.isBenchmark);
                    const training = all.filter((pw) => !pw.isBenchmark);
                    const card = (pw: ProgramWorkout) => (
                      <div className="plan-workout" key={pw.id}>
                        <div className="plan-workout-name">
                          {pw.workout.name}
                          {pw.isBenchmark && <span className="benchmark-badge">Evaluation</span>}
                        </div>
                        <ul className="plan-exercise-list">
                          {pw.workout.exercises.map((e) => (
                            <li key={e.id}>
                              <span className="pe-name">{e.name}</span>
                              <span className="pe-sets">{setSummary(e.sets)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                    return (
                      <>
                        {evals.length > 0 && (
                          <>
                            <div className="section-label">Evaluation — do this first</div>
                            <p className="muted small plan-section-hint">
                              Measures your benchmarks so your training calibrates to your real
                              numbers. Already know them? Enter them on the Plan tab instead.
                            </p>
                            {evals.map(card)}
                          </>
                        )}
                        {training.length > 0 && (
                          <>
                            <div className="section-label">Training workouts</div>
                            <p className="muted small plan-section-hint">
                              You'll work through these in groups, at your own pace — finish a
                              group to unlock the next.
                            </p>
                            {training.map(card)}
                          </>
                        )}
                      </>
                    );
                  })()}
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
                  <CheckIcon size={16} /> Start plan
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
