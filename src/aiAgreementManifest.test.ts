/**
 * ConjureOS #1230: ConjureOS Chat and the orchestrator send this app's data to
 * a model only under the agreement the manifest names. The file and version
 * must be the ones the app writes, or Chat reads a file nobody writes, or a
 * version nobody can reach, and fails closed for everyone.
 *
 * PM decision 2026-11-06: Conjure Fitness asks a separate yes or no just for
 * ConjureOS Chat, in chat-consent.json. The agreement to keep health data
 * (health-consent.json) is not what the manifest names: a no to Chat must not
 * cost anyone the app.
 */
import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import { CHAT_CONSENT_FILE, CHAT_CONSENT_VERSION } from "./features/chatConsent";
import { HEALTH_CONSENT_FILE } from "./features/healthConsent";

describe("the AI agreement the manifest declares", () => {
  const declared = (pkg.conjureos as { aiAgreement?: { file?: unknown; version?: unknown } }).aiAgreement;

  it("is the separate agreement for ConjureOS Chat", () => {
    expect(declared).toBeDefined();
    expect(declared?.file).toBe(CHAT_CONSENT_FILE);
    expect(declared?.file).toBe("chat-consent.json");
    expect(declared?.file).not.toBe(HEALTH_CONSENT_FILE);
  });

  it("is at the version the app asks the person to agree to", () => {
    expect(declared?.version).toBe(CHAT_CONSENT_VERSION);
    expect(declared?.version).toBe(1);
  });

  it("names nothing else", () => {
    expect(Object.keys(declared ?? {}).sort()).toEqual(["file", "version"]);
  });
});
