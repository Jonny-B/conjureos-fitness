import { useState } from "react";
import type { Plan, Profile, Workout } from "../types";
import { BUILT_IN_WORKOUTS } from "../features/workouts";
import { PlayIcon } from "../components/icons";
import { WorkoutRunner, metaLine } from "./WorkoutRunner";

/**
 * Workouts tab — a pure library of ready-to-run workouts. A user's plan
 * workouts live on the Plan tab now; this screen is just "pick a workout to
 * do." Tapping one hands off to the shared WorkoutRunner (overview → player →
 * summary → reflect). The plan is passed through so a finished session still
 * folds into the adaptive loop, even for a library workout.
 */
export function WorkoutsScreen({
  units,
  plan,
  onPlanChange,
}: {
  units: Profile["units"];
  plan: Plan | null;
  onPlanChange: (plan: Plan | null) => void;
}) {
  const [running, setRunning] = useState<Workout | null>(null);

  if (running) {
    return (
      <WorkoutRunner
        workout={running}
        plan={plan}
        units={units}
        onPlanChange={onPlanChange}
        onExit={() => setRunning(null)}
      />
    );
  }

  return (
    <div className="workouts">
      <h1 className="screen-title">Workouts</h1>

      <ul className="workout-list">
        {BUILT_IN_WORKOUTS.map((w) => (
          <li key={w.id}>
            <button className="workout-card" onClick={() => setRunning(w)}>
              <div className="workout-card-text">
                <div className="workout-name">{w.name}</div>
                <div className="workout-summary">{w.summary}</div>
                <div className="workout-meta">{metaLine(w)}</div>
              </div>
              <span className="workout-play" aria-hidden>
                <PlayIcon size={18} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
