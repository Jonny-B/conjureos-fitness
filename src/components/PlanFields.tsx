import type { Profile, Sex } from "../types";
import { NumberField } from "./NumberField";
import { weightToDisplay, weightToKg, weightUnit } from "../features/units";

/**
 * Shared plan/profile field widgets for the plan wizard. Storage is always
 * metric; the display converts per `units`.
 */

export const SEX_LABELS: Record<Sex, string> = {
  male: "Male",
  female: "Female",
  not_shared: "Not Shared",
};

/** Metric/imperial switch. Changes DISPLAY only — storage stays metric. */
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

/** Units toggle on its own row, then bodyweight (for burn estimates). */
export function BodyStatsFields({
  units,
  weightKg,
  onUnits,
  onWeightKg,
}: {
  units: Profile["units"];
  weightKg: number | undefined;
  onUnits: (u: Profile["units"]) => void;
  onWeightKg: (kg: number | undefined) => void;
}) {
  return (
    <div className="body-stats">
      <label className="field">
        <span>Units</span>
        <UnitsToggle units={units} onChange={onUnits} />
      </label>
      <div className="body-stats-row">
        <label className="field">
          <span>Weight ({weightUnit(units)})</span>
          <NumberField
            value={weightKg == null ? undefined : weightToDisplay(weightKg, units)}
            min={weightToDisplay(25, units)}
            max={weightToDisplay(400, units)}
            decimals={1}
            onChange={(n) => onWeightKg(n == null ? undefined : Math.round(weightToKg(n, units) * 100) / 100)}
            aria-label="Weight"
          />
        </label>
      </div>
    </div>
  );
}

/** Age input — the safety intake needs it (under 18 is gated). */
export function AgeField({ age, onChange }: { age: number | undefined; onChange: (n: number | undefined) => void }) {
  return (
    <label className="field">
      <span>Age</span>
      <NumberField value={age} min={10} max={120} onChange={onChange} aria-label="Age" />
    </label>
  );
}

/** Biological-sex picker (it tunes the burn estimate), including "not shared". */
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
