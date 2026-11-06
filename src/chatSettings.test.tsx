// @vitest-environment jsdom
/**
 * Settings has a row for ConjureOS Chat (PM decision 2026-11-06, ConjureOS
 * #1230): whether Chat may use the person's Fitness data, with Allow or
 * Withdraw. Withdraw tells ConjureOS before it writes chat-consent.json null,
 * the order a withdrawal of the agreement to keep health data uses. Allow
 * opens the Chat sheet, which says what Chat gets before the person says yes.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHAT = "chat-consent.json";
const agreedRecord = JSON.stringify({ acceptedAt: "2026-11-01T00:00:00Z", version: 1 });
/** Every report the host was sent, and what the Chat file held then (null: no file). */
const reports: Array<{ state: string; fileAtReport: string | null }> = [];
const files = new Map<string, string>();
let failWrites = false;

function installHost() {
  (window as unknown as { __conjureos?: unknown }).__conjureos = {
    ai: { reportAgreement: (state: string) => reports.push({ state, fileAtReport: files.get(CHAT) ?? null }) },
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
}

let SettingsSheet: typeof import("./screens/SettingsSheet").SettingsSheet;
let chat: typeof import("./features/chatConsent");
let host: HTMLDivElement;
let root: Root;
const onAllowChat = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  ({ SettingsSheet } = await import("./screens/SettingsSheet"));
  chat = await import("./features/chatConsent");
  reports.length = 0;
  files.clear();
  failWrites = false;
  onAllowChat.mockClear();
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

/** Open Settings afresh, as a tap on the cog mounts it. */
async function open() {
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => {
    root.render(
      <SettingsSheet
        goals={{ calories: 2000, protein: 120, carbs: 200, fat: 67 }}
        profile={null}
        plan={null}
        onClose={() => {}}
        onSave={() => {}}
        onPlanChange={() => {}}
        onWithdrawHealthConsent={() => {}}
        onAllowChat={onAllowChat}
      />,
    );
  });
  await tick();
}

const row = () => host.querySelector(".chat-row");
function rowButton(label: string): HTMLButtonElement | undefined {
  return [...(row()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent?.trim() === label);
}
async function click(label: string) {
  const b = rowButton(label);
  expect(b, label).toBeDefined();
  await act(async () => b!.click());
  await tick();
}

describe("the ConjureOS Chat row in Settings", () => {
  it("says Chat may use Fitness data while it is allowed, and offers Withdraw", async () => {
    files.set(CHAT, agreedRecord);
    await open();
    expect(row()).not.toBeNull();
    expect(row()!.textContent).toMatch(/ConjureOS Chat can use your Fitness data/);
    expect(rowButton("Withdraw")).toBeDefined();
    expect(rowButton("Allow")).toBeUndefined();
  });

  it("Withdraw reports withdrawn before the write, then writes null, and the row offers Allow", async () => {
    files.set(CHAT, agreedRecord);
    await open();
    await click("Withdraw");
    expect(reports.map((r) => r.state)).toEqual(["withdrawn"]);
    expect(reports[0]?.fileAtReport).toBe(agreedRecord);
    expect(files.get(CHAT)).toBe("null");
    expect(row()!.textContent).toMatch(/ConjureOS Chat cannot use your Fitness data/);
    expect(rowButton("Allow")).toBeDefined();
    expect(await chat.chatAgreedOnFile()).toBeUndefined();
  });

  it("a withdrawal that could not be saved says so, holds, and a Try again saves it", async () => {
    files.set(CHAT, agreedRecord);
    await open();
    failWrites = true;
    await click("Withdraw");
    expect(row()!.querySelector('[role="alert"]')?.textContent ?? "").toMatch(/not saved/);
    expect(await chat.chatAgreedOnFile()).toBeUndefined();
    failWrites = false;
    await click("Try again");
    expect(files.get(CHAT)).toBe("null");
    expect(row()!.querySelector('[role="alert"]')).toBeNull();
  });

  it("offers Allow when Chat has not been answered, was refused or was withdrawn, and Allow writes nothing itself", async () => {
    for (const raw of [undefined, JSON.stringify({ refusedAt: "2026-11-01T00:00:00Z" }), "null"]) {
      if (raw === undefined) files.delete(CHAT);
      else files.set(CHAT, raw);
      const before = files.get(CHAT);
      await open();
      expect(row()!.textContent, String(raw)).toMatch(/ConjureOS Chat cannot use your Fitness data/);
      await click("Allow");
      expect(files.get(CHAT), String(raw)).toBe(before);
    }
    expect(onAllowChat).toHaveBeenCalledTimes(3);
    expect(reports).toEqual([]);
  });

  it("follows an answer given on the Chat sheet while Settings is open", async () => {
    await open();
    expect(rowButton("Allow")).toBeDefined();
    await act(async () => {
      await chat.recordChatAgreement();
    });
    await tick();
    expect(rowButton("Withdraw")).toBeDefined();
  });

  it("uses no em-dash and never 'now', 'no longer' or 'yet'", async () => {
    for (const raw of [agreedRecord, "null"]) {
      files.set(CHAT, raw);
      await open();
      const text = row()!.textContent ?? "";
      expect(text).not.toMatch(/—/);
      expect(text).not.toMatch(/\bnow\b|\bno longer\b|\byet\b/i);
    }
  });
});
