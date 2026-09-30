import { describe, expect, it } from "vitest";
import type { Plan } from "../types";
import { headerSubtitle } from "./PlanScreen";

const plan = (over: Partial<Plan>): Plan => ({ mode: "both", endDate: "2026-10-27", ...over }) as Plan;

describe("headerSubtitle", () => {
  it("shows the calorie target for a food-tracking plan", () => {
    const p = plan({ mode: "eat_better", targets: { dailyCalories: 2000 } as Plan["targets"] });
    expect(headerSubtitle(p)).toBe(`${(2000).toLocaleString()} cal a day · until 2026-10-27`);
  });
  it("points at the targets section when a food plan has no number yet", () => {
    expect(headerSubtitle(plan({ mode: "both", targets: { dailyCalories: null } }))).toBe(
      "Daily targets below · until 2026-10-27",
    );
  });
  it("never shows a calorie target or 'Daily targets below' for logging_only", () => {
    const withNumber = plan({ mode: "logging_only", targets: { dailyCalories: 2000 } as Plan["targets"] });
    expect(headerSubtitle(withNumber)).toBe("until 2026-10-27");
    expect(headerSubtitle(plan({ mode: "logging_only", targets: { dailyCalories: null } }))).toBe("until 2026-10-27");
    expect(headerSubtitle(plan({ mode: "logging_only", endDate: undefined }))).toBe("");
  });
});
