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
    await repo.upsertWeight({ date: todayISO(), weightKg: Math.round(kg * 10) / 10 });
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
      <div className="weight-card-body">
        <div className="big-stat">
          <span className="big-number">{latest ? weightToDisplay(latest.weightKg, units) : "—"}</span>
          <span className="big-unit">{weightUnit(units)}</span>
        </div>
        <Sparkline points={[...weights].reverse().map((w) => w.weightKg)} />
      </div>
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
