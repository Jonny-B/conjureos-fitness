import { useState } from "react";
import type { CardioActual } from "../types";
import { NumberField } from "./NumberField";

interface Props {
  onSave: (cardio: CardioActual) => void;
  onCancel: () => void;
}

/** Distance + duration entry — the universal cardio fallback (no GPS, denied
 *  permission, tunnels, or the mobile WebView until native GPS lands). */
export function ManualCardioEntry({ onSave, onCancel }: Props) {
  const [km, setKm] = useState<number | undefined>(undefined);
  const [minutes, setMinutes] = useState<number | undefined>(undefined);
  const valid = (km ?? 0) > 0 && (minutes ?? 0) > 0;

  const save = () => {
    const distanceKm = km!;
    const durationSec = Math.round(minutes! * 60);
    onSave({
      distanceKm,
      durationSec,
      avgPaceSecPerKm: distanceKm > 0.05 ? Math.round(durationSec / distanceKm) : undefined,
      source: "manual",
    });
  };

  return (
    <div className="mode-body manual-cardio">
      <label className="field">
        <span className="field-label">Distance (km)</span>
        <NumberField value={km} min={0} max={500} onChange={setKm} aria-label="Distance in km" />
      </label>
      <label className="field">
        <span className="field-label">Duration (minutes)</span>
        <NumberField value={minutes} min={0} max={1000} onChange={setMinutes} aria-label="Duration in minutes" />
      </label>
      <div className="wizard-nav">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={save}>Save</button>
      </div>
    </div>
  );
}
