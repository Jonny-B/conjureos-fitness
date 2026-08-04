/**
 * Compact plan + coach summary for the home screen. Shows the active plan's
 * headline (mode, top goals, daily calorie target) and the coach's running
 * one-liner; taps through to the Plan tab (trends + coach session). With no
 * plan yet it becomes a gentle "meet your coach" entry point (the "build a
 * plan" CTA still lives in the banner slot above).
 */

import { useEffect, useState } from "react";
import type { Goals, Plan } from "../types";
import { loadMemory } from "../features/coach/memory";
import { CoachIcon, ChevronRight } from "./icons";

const MODE_LABEL: Record<string, string> = {
  both: "Eat better + train",
  eat_better: "Eat better",
  get_fit: "Get fit",
  logging_only: "Logging",
};

/** Home-screen card summarizing the active plan, or the create-a-plan prompt
 *  when there isn't one. Tapping it opens the coach. */
export function CoachPlanCard({
  plan,
  goals,
  onOpen,
}: {
  plan: Plan | null;
  goals: Goals;
  onOpen: () => void;
}) {
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadMemory()
      .then((m) => {
        if (alive) setSummary(m.summary?.trim() || null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const topGoals = plan?.goals.slice(0, 3).map((g) => g.label) ?? [];

  return (
    <button className="home-card coach-card" onClick={onOpen} aria-label="Open your coach">
      <div className="home-card-head">
        <span className="home-card-title">
          <CoachIcon size={16} /> {plan ? "Your plan" : "Your coach"}
        </span>
        <ChevronRight size={18} className="muted" />
      </div>

      {plan ? (
        <>
          <div className="coach-card-plan">
            <span className="coach-card-mode">{MODE_LABEL[plan.mode] ?? plan.mode}</span>
            <span className="muted small">·</span>
            <span className="muted small">{goals.calories.toLocaleString()} cal/day</span>
          </div>
          {topGoals.length > 0 && (
            <ul className="coach-card-goals">
              {topGoals.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="muted small">
          Get stat-aware check-ins and a coach that can tune your plan. Tap to chat.
        </div>
      )}

      {summary && <div className="coach-card-summary muted small">{summary}</div>}
    </button>
  );
}
