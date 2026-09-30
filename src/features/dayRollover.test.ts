import { describe, expect, it } from "vitest";
import { rollSelectedDate } from "./dayRollover";

describe("rollSelectedDate", () => {
  it("moves a selection that was today to the new today", () => {
    expect(rollSelectedDate("2026-09-29", "2026-09-29", "2026-09-30")).toBe("2026-09-30");
  });

  it("leaves a date the user chose alone", () => {
    expect(rollSelectedDate("2026-09-20", "2026-09-29", "2026-09-30")).toBe("2026-09-20");
  });

  it("is a no-op when the day has not changed", () => {
    expect(rollSelectedDate("2026-09-30", "2026-09-30", "2026-09-30")).toBe("2026-09-30");
  });
});
