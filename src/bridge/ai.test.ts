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

  it("handles the real strings both hosts actually reject with", () => {
    // Desktop kernel (ConjureOS src/kernel/index.ts) and the mobile runner
    // (conjureos-mobile src/platform/ai.ts) word these differently; both must land.
    expect(aiErrorMessage(new Error("You're out of credits. Top up in ConjureOS Settings on the web."))).toMatch(/out of AI credits/i);
    expect(aiErrorMessage(new Error("Daily free-tier limit reached. Wait for the daily reset, or upgrade on the web."))).toMatch(/today's AI allowance/i);
    expect(aiErrorMessage(new Error("AI provider not configured"))).toMatch(/isn't available/i);
    expect(aiErrorMessage(new Error("Supabase isn't configured."))).toMatch(/isn't available/i);
    expect(aiErrorMessage(new Error("Sign in to use AI."))).toMatch(/sign in/i);
    expect(aiErrorMessage(new Error("app does not have ai.complete permission"))).toMatch(/AI permission/i);
    expect(aiErrorMessage(new Error("ai.complete blocked: ConjureOS is in the background"))).toMatch(/on screen/i);
    expect(aiErrorMessage(new Error('AI proxy request failed (402): {"error":"out_of_credits","tier":"free"}'))).toMatch(/out of AI credits/i);
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
