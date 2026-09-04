import { describe, expect, it } from "vitest";
import { aiErrorMessage, extractJson } from "./ai";

describe("aiErrorMessage", () => {
  it("names the real problem when the host says the user is out of credits", () => {
    expect(aiErrorMessage(new Error("out_of_credits"))).toMatch(/out of AI credits/i);
    expect(aiErrorMessage(new Error("out_of_credits"))).not.toMatch(/connection/i);
  });

  it("distinguishes the daily allowance from a hard credit stop", () => {
    expect(aiErrorMessage(new Error("free_tier_daily_cap_reached"))).toMatch(/today/i);
  });

  it("tells a rate-limited user to wait rather than to retry immediately", () => {
    expect(aiErrorMessage(new Error("ai.complete rate limit (per-minute): too many AI calls"))).toMatch(/wait/i);
  });

  it("explains the foreground gate in the user's terms", () => {
    const msg = aiErrorMessage(new Error("ai.complete blocked: this app's window is minimized"));
    expect(msg).toMatch(/on screen/i);
  });

  it("reports a timeout as slowness, not as an outage", () => {
    expect(aiErrorMessage(new Error("ai timeout"))).toMatch(/too long/i);
  });

  it("keeps an unrecognised host reason visible instead of swallowing it", () => {
    const msg = aiErrorMessage(new Error("kaboom 517"), "The estimator didn't answer.");
    expect(msg).toContain("kaboom 517");
    expect(msg).toContain("The estimator didn't answer.");
  });

  it("falls back cleanly when the rejection carries no message", () => {
    expect(aiErrorMessage(new Error(""), "Nope.")).toBe("Nope.");
    expect(aiErrorMessage(undefined, "Nope.")).toBe("Nope.");
  });
});

describe("extractJson", () => {
  it("unwraps a fenced block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
