import { describe, expect, it } from "vitest";
import { fallbackPlan } from "./fallbackTemplates";
import type { PlanInput } from "./model";

const gatedInput: PlanInput = {
  mode: "logging_only",
  goalText: "",
  durationWeeks: 2,
  safety: { ageBand: "under_18", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "light" },
};

describe("fallbackPlan in Fitness (no food tracking)", () => {
  it("gives a gated logging_only plan no food goals and no calorie target", () => {
    const p = fallbackPlan("logging_only", gatedInput);
    expect(p.goals.length).toBeGreaterThan(0);
    expect(p.goals.map((g) => g.kind)).not.toContain("nutrition");
    expect(p.goals.map((g) => g.label).join(" ")).not.toMatch(/log everything you eat/i);
    expect(p.summary).not.toMatch(/food/i);
    expect(p.dailyCalorieTarget).toBeNull();
  });
});
