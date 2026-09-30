import { describe, expect, it } from "vitest";
import type { SafetyIntake } from "../../types";
import type { GeneratedGoal, GeneratedPlan } from "./model";
import { validatePlan } from "./validate";

const safety = (over: Partial<SafetyIntake> = {}): SafetyIntake => ({
  ageBand: "18_39",
  pregnant: false,
  cardiacFlag: false,
  injuries: [],
  activityLevel: "light",
  ...over,
});
const plan = (goals: GeneratedGoal[]): GeneratedPlan => ({ summary: "s", dailyCalorieTarget: null, goals });

describe("validatePlan: goal text, not the model's kind label, decides what is exercise", () => {
  const mislabelled = plan([
    { label: "Go for a 30-minute run every day", kind: "habit" },
    { label: "Burn fat with sprint intervals", kind: "nutrition" },
  ]);

  it("rejects exercise goals mislabelled habit/nutrition for a gated logging_only plan", () => {
    const res = validatePlan(mislabelled, { mode: "logging_only", safety: safety({ cardiacFlag: true }) });
    expect(res.ok).toBe(false);
    expect(res.reasons).toContain("a logging_only plan must not prescribe workouts");
  });

  it("applies the injury exclusion to a mislabelled exercise goal", () => {
    const res = validatePlan(mislabelled, { mode: "get_fit", safety: safety({ injuries: ["knee"] }) });
    expect(res.ok).toBe(false);
    expect(res.reasons).toContain('workout "Burn fat with sprint intervals" conflicts with a declared injury');
  });

  it("does not flag food goals that merely contain an excluded substring", () => {
    const res = validatePlan(
      plan([
        { label: "Choose brown rice", kind: "nutrition" },
        { label: "Plan a weekend brunch", kind: "habit" },
      ]),
      { mode: "get_fit", safety: safety({ injuries: ["lower_back"] }) },
    );
    expect(res).toEqual({ ok: true, reasons: [] });
  });

  it("accepts a plain habit-only logging_only plan", () => {
    const res = validatePlan(plan([{ label: "A weekly weigh-in", kind: "habit" }]), {
      mode: "logging_only",
      safety: safety({ pregnant: true }),
    });
    expect(res.ok).toBe(true);
  });
});
