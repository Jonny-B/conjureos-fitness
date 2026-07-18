/**
 * Compact weight card for the home screen: latest weight, overall change, a
 * trend sparkline, and an inline quick-log. Reads/writes the same repository
 * methods as the full Weight screen; storage stays metric, display honors the
 * profile's units.
 */

import { useEffect, useState } from "react";
import type { Profile, WeightEntry } from "../types";
import { getRepository } from "../data/repository";
import { todayISO } from "../features/diary";
import { weightToDisplay, weightToKg, weightUnit } from "../features/units";
import { Sparkline } from "./Sparkline";

/**
 * The weight to show, in kg: the newest weigh-in if there is one, else the
 * weight entered in the plan wizard (Profile.weightKg). `fromProfile` marks the
 * latter so the card can caption it. Null only when nothing is known yet.
 */
export function pickWeightKg(
  weights: WeightEntry[],
  profile: Profile | null,
): { kg: number | null; fromProfile: boolean } {
  const latest = weights[0];
  if (latest) return { kg: latest.weightKg, fromProfile: false };
  if (profile && profile.weightKg > 0) return { kg: profile.weightKg, fromProfile: true };
  return { kg: null, fromProfile: false };
}

export function WeightCard({ profile }: { profile: Profile | null }) {
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [input, setInput] = useState("");
  const units = profile?.units ?? "metric";

  const reload = async () => {
    const repo = await getRepository();
    setWeights(await repo.listWeights());
  };
  useEffect(() => {
    reload();
  }, []);

  const add = async () => {
    const shown = Number(input);
    if (!Number.isFinite(shown) || shown <= 0) return;
    const kg = weightToKg(shown, units);
    const repo = await getRepository();
    // Store kg to 2 decimals so a 1-decimal lb entry (0.1 lb ≈ 0.045 kg) round-trips.
    await repo.upsertWeight({ date: todayISO(), weightKg: Math.round(kg * 100) / 100 });
    setInput("");
    await reload();
  };

  const latest = weights[0];
  const oldest = weights[weights.length - 1];
  const changeKg = latest && oldest && weights.length > 1 ? latest.weightKg - oldest.weightKg : 0;
  const changeDisplay =
    units === "imperial"
      ? Math.round(changeKg * 2.2046226218 * 10) / 10
      : Math.round(changeKg * 10) / 10;

  // Always show the last known weight: the newest weigh-in, else the weight the
  // user entered in the plan wizard (Profile.weightKg). Only genuinely-unknown
  // (profile still loading, or never set) shows a prompt instead of a stat.
  const { kg: latestKg, fromProfile } = pickWeightKg(weights, profile);

  return (
    <section className="home-card weight-card">
      <div className="home-card-head">
        <span className="home-card-title">Weight</span>
        {weights.length > 1 && (
          <span className={`home-card-chip ${changeKg <= 0 ? "good" : "bad"}`}>
            {changeKg > 0 ? "+" : ""}
            {changeDisplay} {weightUnit(units)}
          </span>
        )}
      </div>
      {latestKg == null ? (
        <div className="weight-empty muted">Log your first weigh-in to start tracking.</div>
      ) : (
        <div className="weight-card-body">
          <div className="big-stat">
            <span className="big-number">{weightToDisplay(latestKg, units)}</span>
            <span className="big-unit">{weightUnit(units)}</span>
            {fromProfile && <span className="big-note muted">from your plan</span>}
          </div>
          <Sparkline points={[...weights].reverse().map((w) => w.weightKg)} />
        </div>
      )}
      <div className="row gap weigh-in">
        <input
          className="text-input"
          type="number"
          inputMode="decimal"
          placeholder={`Today's weight (${weightUnit(units)})`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn primary" disabled={!input} onClick={add}>
          Log
        </button>
      </div>
    </section>
  );
}
