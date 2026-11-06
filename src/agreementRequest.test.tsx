// @vitest-environment jsdom
/**
 * ConjureOS #1230: Chat asks Fitness to show its agreement.
 *
 * PM decision 2026-11-06: what Chat needs is its own yes or no, in
 * chat-consent.json. The agreement to keep health data comes first: while it
 * is not in place the agreement screen is up, which is what the app shows,
 * and once the person agrees there the Chat sheet follows. Agreeing to keep
 * health data never agrees Chat. With both in place nothing is shown.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registerActions = vi.fn(async () => {});
const CHAT = "chat-consent.json";
const ASKED = "ConjureOS Chat asked to use your Fitness data to answer you.";

// The real bridge wrapper runs against a host that answers the way the shells'
// shims do: anything but false counts as shown. Asserting on that wire value
// is what catches an app answering in a shape the shims misread.
type Ask = () => unknown;
let handler: Ask | null = null;
const ask = async (): Promise<boolean> => Promise.resolve(handler?.()).then((r) => r !== false);
/** Every report the host was sent, and what the Chat file held then (null: no file). */
const reports: Array<{ state: string; fileAtReport: string | null }> = [];
const files = new Map<string, string>();
let failWrites = false;
const installHost = () => {
  (window as unknown as { __conjureos?: unknown }).__conjureos = {
    ai: {
      onAgreementRequest: (fn: Ask) => {
        handler = fn;
        return () => {
          if (handler === fn) handler = null;
        };
      },
      reportAgreement: (state: string) => reports.push({ state, fileAtReport: files.get(CHAT) ?? null }),
    },
  };
  (window as unknown as { __vfs?: unknown }).__vfs = {
    read: async (path: string) => {
      const v = files.get(path);
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    write: async (path: string, content: string) => {
      if (failWrites) throw new Error("vfs down");
      files.set(path, content);
    },
    exists: async (path: string) => files.has(path),
    ls: async () => [],
    mkdir: async () => {},
    rm: async (path: string) => void files.delete(path),
  };
};
/** Whether the agreement to keep health data is on file (features/healthConsent.ts, mocked). */
let onFile = false;

vi.mock("./bridge/actions", () => ({ registerActions: () => registerActions() }));
vi.mock("./features/healthConsent", () => ({
  loadHealthConsent: async () => onFile,
  recordHealthConsent: async () => {
    onFile = true;
    return true;
  },
  healthConsentGranted: () => onFile,
  healthAgreementOnFile: async () => (onFile ? "2026-01-01T00:00:00Z" : undefined),
  withdrawHealthConsent: async () => {
    onFile = false;
    return true;
  },
}));
vi.mock("./features/plan/planService", async (orig) => ({
  ...(await orig<typeof import("./features/plan/planService")>()),
  loadPlan: async () => null,
}));
// Every startup read: lists come back empty, goals as set, the rest as
// nothing on file.
vi.mock("./data/repository", () => {
  const repo = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === "then"
          ? undefined
          : async () =>
              key === "getGoals"
                ? { calories: 2000, protein: 120, carbs: 200, fat: 67 }
                : String(key).startsWith("list")
                  ? []
                  : null,
    },
  );
  return { getRepository: async () => repo };
});

// A fresh App per test: the Chat agreement's session state lives in its module.
let App: typeof import("./App").App;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.resetModules();
  App = (await import("./App")).App;
  registerActions.mockClear();
  handler = null;
  reports.length = 0;
  files.clear();
  failWrites = false;
  onFile = false;
  installHost();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tick = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const settle = async () => {
  await act(async () => {
    root.render(<App />);
  });
  await tick();
};

/** Ask the app to show its agreement, as Chat's Open does. */
async function askNow(): Promise<boolean> {
  let result: boolean | undefined;
  await act(async () => {
    result = await ask();
  });
  await tick();
  return result!;
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
}

async function click(label: string) {
  const b = button(label);
  expect(b, label).toBeDefined();
  await act(async () => b!.click());
  await tick();
}

const chatSheet = () => host.querySelector(".chat-consent");
const agreedRecord = JSON.stringify({ acceptedAt: "2026-11-01T00:00:00Z", version: 1 });

describe("when ConjureOS Chat asks Fitness to show its agreement", () => {
  it("says it is showing it while the agreement to keep health data is not given, that screen being up", async () => {
    await settle();
    expect(host.textContent ?? "").toMatch(/Agree and continue/);
    await expect(askNow()).resolves.toBe(true);
    expect(chatSheet()).toBeNull();
  });

  it("says it shows it too when asked before the file has been read", async () => {
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await expect(ask()).resolves.toBe(true);
    });
  });

  it("shows nothing when both agreements are in force", async () => {
    onFile = true;
    files.set(CHAT, agreedRecord);
    await settle();
    expect(await askNow()).toBe(false);
    expect(chatSheet()).toBeNull();
    expect(host.textContent ?? "").not.toMatch(/Agree and continue/);
  });

  it("shows the Chat sheet when health data may be kept and Chat has not been answered", async () => {
    onFile = true;
    await settle();
    expect(chatSheet()).toBeNull();
    expect(await askNow()).toBe(true);
    expect(chatSheet()).not.toBeNull();
    expect(chatSheet()!.textContent).toContain(ASKED);
    expect(button("Allow")).toBeDefined();
    expect(button("Don't allow")).toBeDefined();
  });

  it("shows the Chat sheet after a refusal or a withdrawal, too", async () => {
    onFile = true;
    for (const raw of [JSON.stringify({ refusedAt: "2026-11-01T00:00:00Z" }), "null"]) {
      files.set(CHAT, raw);
      await settle();
      expect(await askNow(), raw).toBe(true);
      expect(chatSheet(), raw).not.toBeNull();
      await click("Don't allow");
    }
  });

  it("Allow writes { acceptedAt, version: 1 } and reports agreed after the write", async () => {
    onFile = true;
    await settle();
    await askNow();
    await click("Allow");
    const saved = JSON.parse(files.get(CHAT)!) as { acceptedAt: unknown; version: unknown };
    expect(typeof saved.acceptedAt).toBe("string");
    expect(saved.version).toBe(1);
    expect(reports.map((r) => r.state)).toEqual(["agreed"]);
    expect(reports[0]?.fileAtReport).not.toBeNull();
    expect(chatSheet()).toBeNull();
    expect(await askNow()).toBe(false);
  });

  it("Don't allow writes { refusedAt } and reports refused before the write", async () => {
    onFile = true;
    await settle();
    await askNow();
    await click("Don't allow");
    const saved = JSON.parse(files.get(CHAT)!) as { refusedAt: unknown };
    expect(typeof saved.refusedAt).toBe("string");
    expect(Object.keys(saved)).toEqual(["refusedAt"]);
    expect(reports.map((r) => r.state)).toEqual(["refused"]);
    expect(reports[0]?.fileAtReport).toBeNull();
    expect(chatSheet()).toBeNull();
  });

  it("an Allow that could not be saved says so, keeps the sheet up, and saves on a retry", async () => {
    onFile = true;
    await settle();
    await askNow();
    failWrites = true;
    await click("Allow");
    expect(chatSheet()).not.toBeNull();
    expect(host.querySelector('.chat-consent [role="alert"]')?.textContent ?? "").toMatch(/not saved/);
    expect(reports).toEqual([]);
    failWrites = false;
    await click("Allow");
    expect(chatSheet()).toBeNull();
    expect(reports.map((r) => r.state)).toEqual(["agreed"]);
  });

  it("tapping outside the sheet answers nothing", async () => {
    onFile = true;
    await settle();
    await askNow();
    const backdrop = chatSheet()!.closest(".sheet-backdrop") as HTMLElement;
    await act(async () => backdrop.click());
    await tick();
    expect(chatSheet()).toBeNull();
    expect(files.has(CHAT)).toBe(false);
    expect(reports).toEqual([]);
  });

  it("shows the agreement to keep health data first, then the Chat sheet; agreeing there does not agree Chat", async () => {
    await settle();
    expect(await askNow()).toBe(true);
    expect(chatSheet()).toBeNull();
    const box = host.querySelector<HTMLInputElement>('.consent-toggle input[type="checkbox"]');
    await act(async () => box!.click());
    await click("Agree and continue");
    expect(chatSheet()).not.toBeNull();
    expect(chatSheet()!.textContent).toContain(ASKED);
    expect(files.has(CHAT)).toBe(false);
    expect(reports).toEqual([]);
  });

  it("does not follow an agreement to keep health data with the Chat sheet when Chat never asked", async () => {
    await settle();
    const box = host.querySelector<HTMLInputElement>('.consent-toggle input[type="checkbox"]');
    await act(async () => box!.click());
    await click("Agree and continue");
    expect(chatSheet()).toBeNull();
  });

  it("shows the agreement screen when the file stopped being agreed elsewhere while this session says yes", async () => {
    onFile = true;
    files.set(CHAT, agreedRecord);
    await settle();
    expect(host.textContent ?? "").not.toMatch(/Agree and continue/);
    onFile = false;
    expect(await askNow()).toBe(true);
    expect(host.textContent ?? "").toMatch(/Agree and continue/);
  });

  it("is listening only while the app is mounted", async () => {
    await settle();
    expect(handler).not.toBeNull();
    act(() => root.unmount());
    expect(handler).toBeNull();
    root = createRoot(host);
  });
});

describe("Settings' Allow for ConjureOS Chat", () => {
  it("opens the Chat sheet over Settings, and its Allow saves and turns the row to Withdraw", async () => {
    onFile = true;
    await settle();
    const cog = host.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    await act(async () => cog!.click());
    await tick();
    const allowInRow = [...host.querySelectorAll<HTMLButtonElement>(".chat-row button")].find(
      (b) => b.textContent?.trim() === "Allow",
    );
    expect(allowInRow).toBeDefined();
    await act(async () => allowInRow!.click());
    await tick();
    expect(chatSheet()).not.toBeNull();
    // Chat did not ask: the sheet does not say it did.
    expect(chatSheet()!.textContent).not.toContain(ASKED);
    expect(files.has(CHAT)).toBe(false);
    const allowOnSheet = [...chatSheet()!.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === "Allow",
    );
    await act(async () => allowOnSheet!.click());
    await tick();
    expect(chatSheet()).toBeNull();
    expect(reports.map((r) => r.state)).toEqual(["agreed"]);
    const rowButtons = [...host.querySelectorAll<HTMLButtonElement>(".chat-row button")].map((b) => b.textContent?.trim());
    expect(rowButtons).toContain("Withdraw");
  });

  it("sends the person to the agreement to keep health data first when that one is not on file", async () => {
    onFile = true;
    await settle();
    await askNow();
    // The agreement to keep health data stopped being on file (it did not save).
    onFile = false;
    await click("Allow");
    expect(files.has(CHAT)).toBe(false);
    expect(reports).toEqual([]);
    expect(host.textContent ?? "").toMatch(/Agree and continue/);
    const box = host.querySelector<HTMLInputElement>('.consent-toggle input[type="checkbox"]');
    await act(async () => box!.click());
    await click("Agree and continue");
    expect(chatSheet()).not.toBeNull();
  });
});

describe("the Chat sheet's words", () => {
  it("name what Chat can read, with no em-dash and no 'now', 'no longer' or 'yet'", async () => {
    onFile = true;
    await settle();
    await askNow();
    const text = chatSheet()!.textContent ?? "";
    expect(text).toMatch(/workouts/i);
    expect(text).toMatch(/next planned workout/i);
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(/\bnow\b|\bno longer\b|\byet\b/i);
  });
});
