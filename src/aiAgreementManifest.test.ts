/**
 * ConjureOS #1230: ConjureOS Chat and the orchestrator send this app's data to
 * a model only under the agreement the manifest names. The file and version
 * must be the ones the app writes, or Chat reads a file nobody writes, or a
 * version nobody can reach, and fails closed for everyone.
 */
import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import { HEALTH_CONSENT_FILE, HEALTH_CONSENT_VERSION } from "./features/healthConsent";

describe("the AI agreement the manifest declares", () => {
  const declared = (pkg.conjureos as { aiAgreement?: { file?: unknown; version?: unknown } }).aiAgreement;

  it("is the agreement to keep health data, which names what goes to an AI", () => {
    expect(declared).toBeDefined();
    expect(declared?.file).toBe(HEALTH_CONSENT_FILE);
    expect(declared?.file).toBe("health-consent.json");
  });

  it("is at the version the app asks the person to agree to", () => {
    expect(declared?.version).toBe(HEALTH_CONSENT_VERSION);
    expect(Number.isInteger(declared?.version) && (declared?.version as number) > 0).toBe(true);
  });
});
