import { describe, it, expect, vi, beforeEach } from "vitest";

/** Every report the host was sent, and what the file held at that moment (null: no file). */
const reports: Array<{ state: string; fileAtReport: string | null }> = [];
vi.mock("../bridge/agreement", () => ({
  reportAgreement: (state: string) => {
    reports.push({ state, fileAtReport: files.get("health-consent.json") ?? null });
  },
}));

const files = new Map<string, string>();
let failWrites = false;
/** While set, every write waits for it, as an OPFS write waits for close(). */
let heldWrites: Promise<void> | null = null;

vi.mock("../bridge/vfs", () => ({
  readJson: async <T,>(path: string, fallback: T): Promise<T> => {
    const raw = files.get(path);
    if (raw === undefined) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  writeJsonOrThrow: async (path: string, value: unknown): Promise<void> => {
    if (heldWrites) await heldWrites;
    if (failWrites) throw new Error("vfs down");
    files.set(path, JSON.stringify(value));
  },
}));

import {
  HEALTH_CONSENT_VERSION,
  healthConsentGranted,
  loadHealthConsent,
  recordHealthConsent,
  withdrawHealthConsent,
} from "./healthConsent";

beforeEach(() => {
  reports.length = 0;
  files.clear();
  failWrites = false;
  heldWrites = null;
});

/** A new session: the module as it is at startup, nothing in memory. */
async function freshSession() {
  vi.resetModules();
  return import("./healthConsent");
}

describe("consent to collect health data", () => {
  it("is absent until agreed", async () => {
    expect(await loadHealthConsent()).toBe(false);
    expect(healthConsentGranted()).toBe(false);
  });

  it("survives a reload once recorded", async () => {
    expect(await recordHealthConsent()).toBe(true);
    expect(await loadHealthConsent()).toBe(true);
    expect(healthConsentGranted()).toBe(true);
  });

  it("fails closed on an unreadable or old-version record", async () => {
    files.set("health-consent.json", "{not json");
    expect(await loadHealthConsent()).toBe(false);
    files.set("health-consent.json", JSON.stringify({ acceptedAt: "2026-01-01T00:00:00Z", version: HEALTH_CONSENT_VERSION - 1 }));
    expect(await loadHealthConsent()).toBe(false);
  });

  it("lets the person in for the session when the record can't be written, and asks again next time", async () => {
    failWrites = true;
    expect(await recordHealthConsent()).toBe(false);
    expect(healthConsentGranted()).toBe(true);
    expect(await loadHealthConsent()).toBe(false);
  });

  it("stops at once on withdrawal", async () => {
    await recordHealthConsent();
    await withdrawHealthConsent();
    expect(healthConsentGranted()).toBe(false);
    expect(await loadHealthConsent()).toBe(false);
  });
});

/**
 * A withdrawal clears the file, and that write can fail. Collection stops for
 * the session either way, but the next session reads the file, so a failure
 * the caller never hears about leaves the old agreement in force after a
 * reload (found in the ConjureOS #1156 review). The caller has to be told.
 */
describe("a withdrawal says whether it was saved", () => {
  it("reports a saved withdrawal, and the next session finds no agreement", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    expect(await c.withdrawHealthConsent()).toBe(true);
    const next = await freshSession();
    expect(await next.loadHealthConsent()).toBe(false);
  });

  it("reports one it could not save, which the next session would not see", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    failWrites = true;
    expect(await c.withdrawHealthConsent()).toBe(false);
    // Stopped for this session all the same.
    expect(c.healthConsentGranted()).toBe(false);
    expect(await c.healthConsentOnFile()).toBe(false);
    // What a reload would find: the agreement, still on file.
    const next = await freshSession();
    expect(await next.loadHealthConsent()).toBe(true);
  });

  it("saves on a retry once the write goes through", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    failWrites = true;
    expect(await c.withdrawHealthConsent()).toBe(false);
    failWrites = false;
    expect(await c.withdrawHealthConsent()).toBe(true);
    expect(c.healthConsentGranted()).toBe(false);
    const next = await freshSession();
    expect(await next.loadHealthConsent()).toBe(false);
  });
});

/**
 * ConjureOS #1156: the cross-app actions are registered at startup, before the
 * gate has read the file, so their guard must read it rather than refuse a
 * person who agreed long ago.
 */
describe("the cross-app actions' check", () => {
  it("reads an agreement the gate has not loaded yet", async () => {
    const c = await freshSession();
    files.set("health-consent.json", JSON.stringify({ acceptedAt: "2026-01-01T00:00:00Z", version: HEALTH_CONSENT_VERSION }));
    expect(c.healthConsentGranted()).toBe(false);
    expect(await c.healthConsentOnFile()).toBe(true);
    // Its own read settles nothing: only the gate, an agreement or a withdrawal does.
    expect(c.healthConsentGranted()).toBe(false);
  });

  it("says yes for the session after an agreement whose record could not be written", async () => {
    const c = await freshSession();
    failWrites = true;
    await c.recordHealthConsent();
    expect(await c.healthConsentOnFile()).toBe(true);
  });

  it("refuses with nothing on file, and at once after a withdrawal", async () => {
    const c = await freshSession();
    expect(await c.healthConsentOnFile()).toBe(false);
    await c.recordHealthConsent();
    expect(await c.healthConsentOnFile()).toBe(true);
    await c.withdrawHealthConsent();
    expect(await c.healthConsentOnFile()).toBe(false);
  });

  /**
   * The withdrawal clears the file too, and that write can fail. The old
   * agreement still in the file must not switch collection back on.
   */
  it("stays refused after a withdrawal whose record could not be cleared", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    failWrites = true;
    await c.withdrawHealthConsent();
    expect(await c.healthConsentOnFile()).toBe(false);
    expect(c.healthConsentGranted()).toBe(false);
    expect(await c.healthConsentOnFile()).toBe(false);
    expect(await c.loadHealthConsent()).toBe(false);
    expect(await c.healthConsentOnFile()).toBe(false);
  });

  it("refuses while the withdrawal is still being written, and after it lands", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    let land!: () => void;
    heldWrites = new Promise<void>((resolve) => (land = resolve));
    const withdrawing = c.withdrawHealthConsent();
    expect(await c.healthConsentOnFile()).toBe(false);
    expect(c.healthConsentGranted()).toBe(false);
    land();
    await withdrawing;
    expect(files.get("health-consent.json")).toBe("null");
    expect(await c.healthConsentOnFile()).toBe(false);
    expect(c.healthConsentGranted()).toBe(false);
  });

  it("takes the person's agreement after a withdrawal", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    await c.withdrawHealthConsent();
    await c.recordHealthConsent();
    expect(await c.healthConsentOnFile()).toBe(true);
    expect(await c.loadHealthConsent()).toBe(true);
  });
});

/**
 * ConjureOS #1230: Chat checks this agreement before Fitness's data reaches a
 * model. A withdrawal is told to the host before the file write, which can
 * fail or lag; an agreement only after it is saved, because the file is the
 * only thing that can make the app agreed.
 */
describe("telling ConjureOS about the agreement", () => {
  it("reports a withdrawal before the write, while the old agreement is still on file", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    reports.length = 0;
    await c.withdrawHealthConsent();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.state).toBe("withdrawn");
    expect(reports[0]?.fileAtReport).not.toBe("null");
  });

  it("reports a withdrawal even when the write fails", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    reports.length = 0;
    failWrites = true;
    expect(await c.withdrawHealthConsent()).toBe(false);
    expect(reports.map((r) => r.state)).toEqual(["withdrawn"]);
  });

  it("reports nothing on an agreement to keep health data: what ConjureOS hears follows the Chat file", async () => {
    const c = await freshSession();
    expect(await c.recordHealthConsent()).toBe(true);
    expect(reports).toEqual([]);
  });

  it("reports no agreement when the write fails", async () => {
    const c = await freshSession();
    failWrites = true;
    expect(await c.recordHealthConsent()).toBe(false);
    expect(reports).toEqual([]);
  });
});

/**
 * The yes or no for ConjureOS Chat is its own file, chat-consent.json (PM
 * decision 2026-11-06). Withdrawing the agreement to keep health data
 * withdraws Chat too; agreeing to keep health data does not agree Chat.
 */
describe("the Chat agreement beside it", () => {
  const CHAT = "chat-consent.json";
  const chatAgreed = JSON.stringify({ acceptedAt: "2026-11-01T00:00:00Z", version: 1 });

  it("is withdrawn with it: chat-consent.json is written null, and ConjureOS is told before either write", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    files.set(CHAT, chatAgreed);
    reports.length = 0;
    let land!: () => void;
    heldWrites = new Promise<void>((resolve) => (land = resolve));
    const withdrawing = c.withdrawHealthConsent();
    // Told at once, while both files still hold their agreements.
    expect(reports.map((r) => r.state)).toEqual(["withdrawn"]);
    expect(files.get("health-consent.json")).not.toBe("null");
    expect(files.get(CHAT)).toBe(chatAgreed);
    land();
    expect(await withdrawing).toBe(true);
    expect(files.get(CHAT)).toBe("null");
    expect(files.get("health-consent.json")).toBe("null");
    expect(reports.map((r) => r.state)).toEqual(["withdrawn"]);
  });

  it("is withdrawn with it when Chat was never answered, too", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    expect(await c.withdrawHealthConsent()).toBe(true);
    expect(files.get(CHAT)).toBe("null");
  });

  it("says the withdrawal was not saved when only the Chat file could not be cleared", async () => {
    const c = await freshSession();
    await c.recordHealthConsent();
    files.set(CHAT, chatAgreed);
    const realSet = files.set.bind(files);
    files.set = (k: string, v: string) => {
      if (k === CHAT) throw new Error("vfs down");
      return realSet(k, v);
    };
    try {
      expect(await c.withdrawHealthConsent()).toBe(false);
    } finally {
      files.set = realSet;
    }
    expect(files.get("health-consent.json")).toBe("null");
  });

  it("is left as it was by an agreement to keep health data", async () => {
    const c = await freshSession();
    expect(await c.recordHealthConsent()).toBe(true);
    expect(files.has(CHAT)).toBe(false);
    await c.withdrawHealthConsent();
    expect(await c.recordHealthConsent()).toBe(true);
    expect(files.get(CHAT)).toBe("null");
    expect(reports.map((r) => r.state)).toEqual(["withdrawn"]);
  });
});
