import { describe, expect, it } from "vitest";
import type { Plan } from "../types";
import { headerSubtitle } from "./PlanScreen";

const plan = (over: Partial<Plan>): Plan => ({ mode: "get_fit", endDate: "2026-10-27", ...over }) as Plan;

describe("headerSubtitle", () => {
  it("shows the plan's end date, and no calorie target", () => {
    expect(headerSubtitle(plan({}))).toBe("until 2026-10-27");
    expect(headerSubtitle(plan({ mode: "logging_only" }))).toBe("until 2026-10-27");
  });
  it("is empty for a plan with no end date", () => {
    expect(headerSubtitle(plan({ mode: "logging_only", endDate: undefined }))).toBe("");
  });
});
