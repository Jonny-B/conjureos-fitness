import { describe, it, expect } from "vitest";
import { planModeLabel } from "./display";
import type { Plan } from "../../types";

const plan = (mode: Plan["mode"]) => ({ mode }) as Plan;

describe("planModeLabel", () => {
  it("names each mode", () => {
    expect(planModeLabel(plan("get_fit"))).toBe("Get fit");
    expect(planModeLabel(plan("logging_only"))).toBe("Habits only");
  });
});
