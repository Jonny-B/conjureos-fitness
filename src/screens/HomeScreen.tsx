/**
 * Conjure Fitness's opening screen: the plan's next workout, the coach, and the
 * last few sessions, each a tap away from its own tab.
 *
 * A first cut (2026-09-28), made when calorie tracking moved to Conjure Health
 * and this app became fitness only. It reuses the existing cards and styles; it
 * has no design of its own yet.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Plan, Profile, WorkoutSession } from "../types";
import { getRepository } from "../data/repository";
import { currentGroup, workoutsInGroup } from "../features/plan/groups";
import { planModeLabel } from "../features/plan/display";
import { fmtDistance, fmtDuration } from "../features/units";
import { CoachLauncher } from "./PlanScreen";
import { ChevronRight, CoachIcon, WorkoutsIcon } from "../components/icons";

/** How many finished sessions the "Recent" card lists. */
const RECENT_LIMIT = 5;

export function HomeScreen({
  plan,
  units,
  nonce,
  banner,
  onOpenWorkouts,
  onOpenPlan,
  onAskCoach,
}: {
  plan: Plan | null;
  units: Profile["units"];
  /** App-wide invalidation counter; bumped after any write. */
  nonce: number;
  /** The plan / evening check-in banners, when App has one to show. */
  banner?: ReactNode;
  onOpenWorkouts: () => void;
  onOpenPlan: () => void;
  onAskCoach: (question: string) => void;
}) {
  const [recent, setRecent] = useState<WorkoutSession[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const repo = await getRepository();
      const sessions = await repo.listWorkoutSessions(RECENT_LIMIT).catch(() => []);
      if (alive) setRecent(sessions);
    })();
    return () => {
      alive = false;
    };
  }, [nonce]);

  // The first unfinished workout in the group the plan is working through.
  const program = plan?.program;
  const next = program
    ? workoutsInGroup(program, currentGroup(program)).find((w) => !w.completedAt)
    : undefined;
  const loggingOnly = plan?.mode === "logging_only";
  const topGoals = plan ? plan.goals.slice(0, 3) : [];

  return (
    <div className="workouts">
      {banner}
      <h1 className="screen-title">Today</h1>

      {!loggingOnly && (
        <button className="home-card" onClick={onOpenWorkouts} aria-label="Open workouts">
          <div className="home-card-head">
            <span className="home-card-title">
              <WorkoutsIcon size={16} /> {next ? "Next workout" : "Workouts"}
            </span>
            <ChevronRight size={18} className="muted" />
          </div>
          {next ? (
            <>
              <div>{next.workout.name}</div>
              {next.workout.summary && <div className="muted small">{next.workout.summary}</div>}
            </>
          ) : (
            <div className="muted small">
              Pick a guided workout or track a run. Build a plan to get a program made for you.
            </div>
          )}
        </button>
      )}

      <button className="home-card" onClick={onOpenPlan} aria-label={plan ? "Open your plan" : "Build a plan"}>
        <div className="home-card-head">
          <span className="home-card-title">
            <CoachIcon size={16} /> Your plan
          </span>
          <ChevronRight size={18} className="muted" />
        </div>
        {plan ? (
          <>
            <div>{planModeLabel(plan)}</div>
            {topGoals.length > 0 && (
              <ul className="coach-card-goals">
                {topGoals.map((g, i) => (
                  <li key={i}>{g.label}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="muted small">
            Tell the coach what you want to get better at and it builds a program around it.
          </div>
        )}
      </button>

      <CoachLauncher onAsk={onAskCoach} />

      <section className="home-card" aria-label="Recent workouts">
        <div className="home-card-head">
          <span className="home-card-title">Recent</span>
        </div>
        {recent === null ? null : recent.length === 0 ? (
          <div className="muted small">No workouts yet. Finished sessions show up here.</div>
        ) : (
          <ul className="coach-card-goals">
            {recent.map((s) => (
              <li key={s.id}>
                {s.workoutName ?? (s.cardio ? "Cardio" : "Workout")}
                <span className="muted small">
                  {" · "}
                  {s.date}
                  {s.cardio ? ` · ${fmtDistance(s.cardio.distanceKm, units)}` : ""}
                  {fmtDuration(s.durationSec ?? s.cardio?.durationSec)
                    ? ` · ${fmtDuration(s.durationSec ?? s.cardio?.durationSec)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
