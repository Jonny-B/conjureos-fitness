import { describe, it, expect } from "vitest";
import { planModeLabel, visiblePlanGoals } from "./display";
import { COACH_AND_WORKOUTS_ENABLED } from "../flags";
import type { Plan, PlanGoal } from "../../types";

const goal = (kind: PlanGoal["kind"], label: string): PlanGoal => ({ id: label, label, kind });

// A plan with food and workout goals on it (mode "both").
const legacy = {
  id: "p1",
  mode: "both",
  durationWeeks: 4,
  startDate: "2026-07-27",
  endDate: "2026-08-24",
  goals: [
    goal("nutrition", "Hit a 300-500 cal daily deficit"),
    goal("workout", "Run 1.5-3 miles 2x per week"),
    goal("workout", "Murph-specific strength session (Day 1)"),
    goal("habit", "Weigh in every morning"),
  ],
  safety: {} as Plan["safety"],
  liability: {} as Plan["liability"],
  createdAt: "2026-07-27T00:00:00Z",
} as Plan;

describe("plan display with workouts on (Conjure Fitness)", () => {
  it("is only meaningful with the flag on (guards the rest of this suite)", () => {
    expect(COACH_AND_WORKOUTS_ENABLED).toBe(true);
  });

  it("labels a plan by its own mode", () => {
    expect(planModeLabel(legacy)).toBe("Eat better + train");
    expect(planModeLabel({ ...legacy, mode: "get_fit" })).toBe("Get fit");
  });

  it("shows every goal, workout goals included", () => {
    expect(visiblePlanGoals(legacy).map((g) => g.label)).toEqual(legacy.goals.map((g) => g.label));
  });
});
