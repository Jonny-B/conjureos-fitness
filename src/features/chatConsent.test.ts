/**
 * The separate yes or no for ConjureOS Chat (PM decision 2026-11-06, on the
 * owner's behalf, ConjureOS #1230). It lives in chat-consent.json, beside the
 * agreement to keep health data, in the shapes ConjureOS reads:
 *
 *   missing                     not answered
 *   null                        withdrawn
 *   { refusedAt }               refused
 *   { acceptedAt, version: 1 }  agreed
 *   anything else               unknown, never agreed
 *
 * The host is told a withdrawal or a refusal before the file is written, and
 * an agreement only after it is saved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const FILE = "chat-consent.json";

/** Every report the host was sent, and what the Chat file held at that moment (null: no file). */
const reports: Array<{ state: string; fileAtReport: string | null }> = [];
vi.mock("../bridge/agreement", () => ({
  reportAgreement: (state: string) => {
    reports.push({ state, fileAtReport: files.get(FILE) ?? null });
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

const HEALTH = "health-consent.json";
const healthAgreed = JSON.stringify({ acceptedAt: "2026-10-01T00:00:00Z", version: 1 });

beforeEach(() => {
  reports.length = 0;
  files.clear();
  // Chat cannot be allowed without the agreement to keep health data on file.
  files.set(HEALTH, healthAgreed);
  failWrites = false;
  heldWrites = null;
});

/** A new session: the module as it is at startup, nothing in memory. */
async function freshSession() {
  vi.resetModules();
  return import("./chatConsent");
}

const stored = () => {
  const raw = files.get(FILE);
  return raw === undefined ? undefined : (JSON.parse(raw) as unknown);
};

describe("the Chat agreement file", () => {
  it("is chat-consent.json at version 1", async () => {
    const c = await freshSession();
    expect(c.CHAT_CONSENT_FILE).toBe("chat-consent.json");
    expect(c.CHAT_CONSENT_VERSION).toBe(1);
  });

  it("reads each shape the way ConjureOS does", async () => {
    const c = await freshSession();
    expect(await c.chatAgreementState()).toBe("not_answered");
    files.set(FILE, "null");
    expect(await c.chatAgreementState()).toBe("withdrawn");
    files.set(FILE, JSON.stringify({ refusedAt: "2026-11-01T00:00:00Z" }));
    expect(await c.chatAgreementState()).toBe("refused");
    files.set(FILE, JSON.stringify({ acceptedAt: "2026-11-01T00:00:00Z", version: 1 }));
    expect(await c.chatAgreementState()).toBe("agreed");
  });

  it("never reads anything else as agreed", async () => {
    const c = await freshSession();
    for (const raw of [
      JSON.stringify({ acceptedAt: "2026-11-01T00:00:00Z", version: 2 }),
      JSON.stringify({ acceptedAt: "2026-11-01T00:00:00Z" }),
      JSON.stringify({ acceptedAt: 5, version: 1 }),
      JSON.stringify({ version: 1 }),
      JSON.stringify("agreed"),
      JSON.stringify(true),
      JSON.stringify([]),
    ]) {
      files.set(FILE, raw);
      expect(await c.chatAgreementState(), raw).toBe("unknown");
      expect(await c.chatAgreedOnFile(), raw).toBeUndefined();
    }
    files.set(FILE, "{not json");
    expect(await c.chatAgreementState()).not.toBe("agreed");
    expect(await c.chatAgreedOnFile()).toBeUndefined();
  });

  it("gives the agreement's date only while the file holds an agreement", async () => {
    const c = await freshSession();
    expect(await c.chatAgreedOnFile()).toBeUndefined();
    files.set(FILE, JSON.stringify({ acceptedAt: "2026-11-01T00:00:00Z", version: 1 }));
    expect(await c.chatAgreedOnFile()).toBe("2026-11-01T00:00:00Z");
    // Another device withdraws: the file changes, and the next read says so.
    files.set(FILE, "null");
    expect(await c.chatAgreedOnFile()).toBeUndefined();
  });
});

describe("Allow", () => {
  it("writes { acceptedAt, version: 1 } and reports agreed after the write", async () => {
    const c = await freshSession();
    expect(await c.recordChatAgreement()).toBe(true);
    const saved = stored() as { acceptedAt: unknown; version: unknown };
    expect(typeof saved.acceptedAt).toBe("string");
    expect(saved.version).toBe(1);
    expect(Object.keys(saved).sort()).toEqual(["acceptedAt", "version"]);
    expect(reports.map((r) => r.state)).toEqual(["agreed"]);
    expect(reports[0]?.fileAtReport).not.toBeNull();
    expect(await c.chatAgreementState()).toBe("agreed");
  });

  it("reports nothing and is not in force when the write fails", async () => {
    const c = await freshSession();
    failWrites = true;
    expect(await c.recordChatAgreement()).toBe(false);
    expect(reports).toEqual([]);
    expect(await c.chatAgreedOnFile()).toBeUndefined();
  });

  it("survives a reload", async () => {
    const c = await freshSession();
    await c.recordChatAgreement();
    const next = await freshSession();
    expect(await next.chatAgreementState()).toBe("agreed");
  });

  /**
   * The Chat sheet checks the agreement to keep health data before it saves,
   * and another device can withdraw that agreement while the save is made.
   * ConjureOS reads this file alone, so an agreement left on it would read as
   * agreed without the one it cannot stand without (#1230 review).
   */
  it("withdraws itself when the agreement to keep health data is gone by the time it is saved", async () => {
    const c = await freshSession();
    let land!: () => void;
    heldWrites = new Promise<void>((resolve) => (land = resolve));
    const allowing = c.recordChatAgreement();
    // Another device withdraws the agreement to keep health data meanwhile.
    files.set(HEALTH, "null");
    heldWrites = null;
    land();
    expect(await allowing).toBe(false);
    expect(files.get(FILE)).toBe("null");
    expect(reports.map((r) => r.state)).toEqual(["withdrawn"]);
    expect(await c.chatAgreedOnFile()).toBeUndefined();
    expect(await (await freshSession()).chatAgreementState()).toBe("withdrawn");
  });
});

describe("Don't allow", () => {
  it("reports refused before the write, then writes { refusedAt }", async () => {
    const c = await freshSession();
    expect(await c.refuseChatAgreement()).toBe(true);
    expect(reports.map((r) => r.state)).toEqual(["refused"]);
    expect(reports[0]?.fileAtReport).toBeNull();
    const saved = stored() as { refusedAt: unknown };
    expect(typeof saved.refusedAt).toBe("string");
    expect(Object.keys(saved)).toEqual(["refusedAt"]);
    expect(await c.chatAgreementState()).toBe("refused");
  });

  it("holds for the session even when the write fails", async () => {
    const c = await freshSession();
    files.set(FILE, JSON.stringify({ acceptedAt: "2026-11-01T00:00:00Z", version: 1 }));
    failWrites = true;
    expect(await c.refuseChatAgreement()).toBe(false);
    expect(reports.map((r) => r.state)).toEqual(["refused"]);
    expect(await c.chatAgreementState()).toBe("refused");
    expect(await c.chatAgreedOnFile()).toBeUndefined();
  });
});

describe("Withdraw", () => {
  it("reports withdrawn before the write, while the agreement is still on file, then writes null", async () => {
    const c = await freshSession();
    await c.recordChatAgreement();
    reports.length = 0;
    expect(await c.withdrawChatAgreement()).toBe(true);
    expect(reports.map((r) => r.state)).toEqual(["withdrawn"]);
    expect(reports[0]?.fileAtReport).not.toBe("null");
    expect(files.get(FILE)).toBe("null");
    expect(await c.chatAgreementState()).toBe("withdrawn");
  });

  it("stops at once, while the write is still being made", async () => {
    const c = await freshSession();
    await c.recordChatAgreement();
    let land!: () => void;
    heldWrites = new Promise<void>((resolve) => (land = resolve));
    const withdrawing = c.withdrawChatAgreement();
    expect(await c.chatAgreedOnFile()).toBeUndefined();
    land();
    expect(await withdrawing).toBe(true);
    expect(await c.chatAgreedOnFile()).toBeUndefined();
  });

  it("says when it was not saved, holds for the session, and saves on a retry", async () => {
    const c = await freshSession();
    await c.recordChatAgreement();
    failWrites = true;
    expect(await c.withdrawChatAgreement()).toBe(false);
    expect(await c.chatAgreedOnFile()).toBeUndefined();
    expect(await c.chatAgreementState()).toBe("withdrawn");
    failWrites = false;
    expect(await c.withdrawChatAgreement()).toBe(true);
    const next = await freshSession();
    expect(await next.chatAgreementState()).toBe("withdrawn");
  });

  it("moves the generation, so work that began under the agreement keeps nothing", async () => {
    const c = await freshSession();
    await c.recordChatAgreement();
    const g = c.chatConsentGeneration();
    expect(c.stillChatAgreed(g)).toBe(true);
    await c.withdrawChatAgreement();
    expect(c.stillChatAgreed(g)).toBe(false);
    expect(c.stillChatAgreed(c.chatConsentGeneration())).toBe(false);
  });

  it("lets the person allow again afterwards", async () => {
    const c = await freshSession();
    await c.recordChatAgreement();
    await c.withdrawChatAgreement();
    expect(await c.recordChatAgreement()).toBe(true);
    expect(await c.chatAgreementState()).toBe("agreed");
    expect(c.stillChatAgreed(c.chatConsentGeneration())).toBe(true);
  });

  it("tells a listener about every answer", async () => {
    const c = await freshSession();
    const seen: number[] = [];
    const off = c.onChatAgreementChange(() => seen.push(1));
    await c.recordChatAgreement();
    await c.withdrawChatAgreement();
    await c.refuseChatAgreement();
    off();
    await c.recordChatAgreement();
    expect(seen).toHaveLength(3);
  });
});
