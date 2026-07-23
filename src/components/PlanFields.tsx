import type { ActivityLevel, ExperienceLevel, GoalDirection, Profile, Sex } from "../types";
import { ACTIVITY_LABELS } from "../features/goals";
import { NumberField } from "./NumberField";
import { cmToIn, inToCm, weightToDisplay, weightToKg, weightUnit } from "../features/units";

/**
 * Shared plan/profile field widgets used by BOTH the wizard and the Settings
 * cog, so the two surfaces stay in lockstep (edit one field, it's the same
 * everywhere). Storage is always metric; the display converts per `units`.
 */

export const SEX_LABELS: Record<Sex, string> = {
  male: "Male",
  female: "Female",
  not_shared: "Not Shared",
};

const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const DIRECTION_LABELS: Record<GoalDirection, string> = {
  lose: "Lose weight",
  maintain: "Maintain",
  gain: "Gain weight",
};

export function UnitsToggle({
  units,
  onChange,
}: {
  units: Profile["units"];
  onChange: (u: Profile["units"]) => void;
}) {
  return (
    <div className="chip-row units-toggle">
      {(["metric", "imperial"] as const).map((u) => (
        <button key={u} type="button" className={`chip${units === u ? " active" : ""}`} onClick={() => onChange(u)}>
          {u === "metric" ? "Metric" : "Imperial"}
        </button>
      ))}
    </div>
  );
}

/** Height + weight number inputs with the metric/imperial toggle to their left. */
export function BodyStatsFields({
  units,
  heightCm,
  weightKg,
  onUnits,
  onHeightCm,
  onWeightKg,
}: {
  units: Profile["units"];
  heightCm: number | undefined;
  weightKg: number | undefined;
  onUnits: (u: Profile["units"]) => void;
  onHeightCm: (cm: number | undefined) => void;
  onWeightKg: (kg: number | undefined) => void;
}) {
  return (
    <div className="body-stats">
      <label className="field">
        <span>Units</span>
        <UnitsToggle units={units} onChange={onUnits} />
      </label>
      <HeightField units={units} heightCm={heightCm} onChange={onHeightCm} />
      <label className="field">
        <span>Weight ({weightUnit(units)})</span>
        <NumberField
          value={weightKg == null ? undefined : weightToDisplay(weightKg, units)}
          min={weightToDisplay(25, units)}
          max={weightToDisplay(400, units)}
          onChange={(n) => onWeightKg(n == null ? undefined : Math.round(weightToKg(n, units) * 10) / 10)}
          aria-label="Weight"
        />
      </label>
    </div>
  );
}

/**
 * Height input. Metric = one cm field; imperial = feet + inches side by side
 * (nobody thinks of themselves as "72 inches"). Storage is always cm. Shared by
 * the wizard and the Settings cog so the two stay in lockstep.
 */
export function HeightField({
  units,
  heightCm,
  onChange,
}: {
  units: Profile["units"];
  heightCm: number | undefined;
  onChange: (cm: number | undefined) => void;
}) {
  if (units === "metric") {
    return (
      <label className="field">
        <span>Height (cm)</span>
        <NumberField
          value={heightCm == null ? undefined : Math.round(heightCm)}
          min={90}
          max={250}
          onChange={(n) => onChange(n == null ? undefined : n)}
          aria-label="Height"
        />
      </label>
    );
  }
  const totalIn = heightCm == null ? undefined : Math.round(cmToIn(heightCm));
  const ft = totalIn == null ? undefined : Math.floor(totalIn / 12);
  const inch = totalIn == null ? undefined : totalIn % 12;
  const set = (f: number | undefined, i: number | undefined) => {
    if (f == null && i == null) {
      onChange(undefined);
      return;
    }
    const total = (f ?? 0) * 12 + (i ?? 0);
    onChange(total > 0 ? Math.round(inToCm(total)) : undefined);
  };
  return (
    <label className="field">
      <span>Height (ft / in)</span>
      <div className="height-imperial">
        <NumberField value={ft} min={3} max={8} onChange={(n) => set(n, inch)} aria-label="Height feet" placeholder="ft" />
        <NumberField value={inch} min={0} max={11} onChange={(n) => set(ft, n)} aria-label="Height inches" placeholder="in" />
      </div>
    </label>
  );
}

/**
 * Target weight. Storage metric; display per units. With `optional`, it frames
 * the derive-the-direction flow: below your weight = lose, above = gain, blank
 * = maintain — no separate lose/maintain/gain selector needed.
 */
export function GoalWeightField({
  units,
  goalWeightKg,
  onChange,
  optional = false,
}: {
  units: Profile["units"];
  goalWeightKg: number | undefined;
  onChange: (kg: number | undefined) => void;
  optional?: boolean;
}) {
  return (
    <label className="field">
      <span>Goal weight ({weightUnit(units)}){optional ? " — optional" : ""}</span>
      <NumberField
        value={goalWeightKg == null ? undefined : weightToDisplay(goalWeightKg, units)}
        min={weightToDisplay(25, units)}
        max={weightToDisplay(400, units)}
        onChange={(n) => onChange(n == null ? undefined : Math.round(weightToKg(n, units) * 10) / 10)}
        aria-label="Goal weight"
        placeholder={optional ? "blank = maintain" : undefined}
      />
      {optional && (
        <span className="muted small field-hint">
          Below your weight = lose · above = gain · blank = maintain
        </span>
      )}
    </label>
  );
}

export function AgeField({ age, onChange }: { age: number | undefined; onChange: (n: number | undefined) => void }) {
  return (
    <label className="field">
      <span>Age</span>
      <NumberField value={age} min={10} max={120} onChange={onChange} aria-label="Age" />
    </label>
  );
}

export function SexField({ sex, onChange }: { sex: Sex; onChange: (s: Sex) => void }) {
  return (
    <label className="field">
      <span>Sex</span>
      <select className="select" value={sex} onChange={(e) => onChange(e.target.value as Sex)}>
        {(Object.keys(SEX_LABELS) as Sex[]).map((s) => (
          <option key={s} value={s}>
            {SEX_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ExperienceField({
  value,
  onChange,
}: {
  value: ExperienceLevel;
  onChange: (v: ExperienceLevel) => void;
}) {
  return (
    <label className="field">
      <span>Experience level</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as ExperienceLevel)}>
        {(Object.keys(EXPERIENCE_LABELS) as ExperienceLevel[]).map((k) => (
          <option key={k} value={k}>
            {EXPERIENCE_LABELS[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ActivityField({
  value,
  onChange,
}: {
  value: ActivityLevel;
  onChange: (v: ActivityLevel) => void;
}) {
  return (
    <label className="field">
      <span>Activity level</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as ActivityLevel)}>
        {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
          <option key={k} value={k}>
            {ACTIVITY_LABELS[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DirectionField({
  value,
  onChange,
}: {
  value: GoalDirection;
  onChange: (v: GoalDirection) => void;
}) {
  return (
    <label className="field">
      <span>Goal</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as GoalDirection)}>
        {(Object.keys(DIRECTION_LABELS) as GoalDirection[]).map((k) => (
          <option key={k} value={k}>
            {DIRECTION_LABELS[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** End date picker (+ optional Start). The wizard hides Start — today is
 *  implied — and shows a single "Plan until" date; the cog shows both to edit
 *  an existing plan's window. Plan length derives from the span. */
export function PlanDatesField({
  startDate,
  endDate,
  onStart,
  onEnd,
  hideStart = false,
}: {
  startDate: string;
  endDate: string;
  onStart: (d: string) => void;
  onEnd: (d: string) => void;
  /** Wizard sets this — start stays today implicitly, only the end is picked. */
  hideStart?: boolean;
}) {
  if (hideStart) {
    return (
      <label className="field">
        <span>Plan until</span>
        <input className="text-input" type="date" value={endDate} min={startDate || undefined} onChange={(e) => onEnd(e.target.value)} />
      </label>
    );
  }
  return (
    <div className="row gap plan-dates">
      <label className="field">
        <span>Start</span>
        <input className="text-input" type="date" value={startDate} max={endDate || undefined} onChange={(e) => onStart(e.target.value)} />
      </label>
      <label className="field">
        <span>End</span>
        <input className="text-input" type="date" value={endDate} min={startDate || undefined} onChange={(e) => onEnd(e.target.value)} />
      </label>
    </div>
  );
}

/** Inclusive whole-week count between two YYYY-MM-DD dates (min 1, cap 52). */
export function weeksBetween(startISO: string, endISO: string): number {
  const [ys, ms, ds] = startISO.split("-").map(Number);
  const [ye, me, de] = endISO.split("-").map(Number);
  if (!ys || !ye) return 1;
  const start = Date.UTC(ys, (ms ?? 1) - 1, ds ?? 1);
  const end = Date.UTC(ye, (me ?? 1) - 1, de ?? 1);
  const days = Math.round((end - start) / 86400000) + 1;
  return Math.min(52, Math.max(1, Math.round(days / 7)));
}
