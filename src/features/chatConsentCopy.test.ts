/**
 * The Chat sheet must not promise what the reads give away: a workout's
 * calories are worked out from the person's weight (bridge/fitnessActions.ts,
 * estimateKcal), so the sheet says so where it lists the calories, and does not
 * list weight as something Chat never gets without saying what it can infer.
 */
import { describe, expect, it } from "vitest";
import { CHAT_READS, CHAT_WITHHOLDS } from "./chatConsentCopy";

describe("the Chat sheet's words about weight", () => {
  it("say the calories Chat reads are worked out from your weight", () => {
    expect(CHAT_READS.join(" ")).toMatch(/worked out from your weight/);
  });
  it("do not list weight as never sent without that caveat", () => {
    const weightLine = CHAT_WITHHOLDS.find((l) => /weight/i.test(l));
    if (weightLine) expect(weightLine).toMatch(/itself/);
  });
  it("carry no em-dash and never say now, no longer or yet", () => {
    const all = [...CHAT_READS, ...CHAT_WITHHOLDS].join(" ");
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/\b(now|no longer|yet)\b/i);
  });
});
