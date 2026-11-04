// @vitest-environment jsdom
/**
 * ConjureOS #1230: Chat asks Fitness to show its agreement. The agreement
 * screen is already up whenever consent is not given, so the answer there is
 * that something is shown; with the agreement in force nothing is shown.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registerActions = vi.fn(async () => {});

type Ask = () => { shown: boolean } | Promise<{ shown: boolean }>;
let ask: Ask | null = null;
vi.mock("./bridge/agreement", () => ({
  reportAgreement: () => {},
  onAgreementRequest: (fn: Ask) => {
    ask = fn;
    return () => {
      if (ask === fn) ask = null;
    };
  },
}));
let onFile = false;

vi.mock("./bridge/actions", () => ({ registerActions: () => registerActions() }));
vi.mock("./features/healthConsent", () => ({
  loadHealthConsent: async () => onFile,
  recordHealthConsent: async () => true,
  healthConsentGranted: () => onFile,
  withdrawHealthConsent: async () => true,
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

import { App } from "./App";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  registerActions.mockClear();
  ask = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const settle = async () => {
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("when ConjureOS Chat asks Fitness to show its agreement", () => {
  it("says it is showing it while no agreement is given, the screen being up", async () => {
    onFile = false;
    await settle();
    expect(host.textContent ?? "").toMatch(/agree/i);
    await expect(ask?.()).resolves.toEqual({ shown: true });
  });

  it("says it shows it too when asked before the file has been read", async () => {
    onFile = false;
    await act(async () => {
      root.render(<App />);
    });
    await expect(ask?.()).resolves.toEqual({ shown: true });
  });

  it("shows nothing when the agreement is in force", async () => {
    onFile = true;
    await settle();
    expect(host.textContent ?? "").not.toMatch(/Agree and continue/);
    await expect(ask?.()).resolves.toEqual({ shown: false });
  });

  it("is listening only while the app is mounted", async () => {
    onFile = false;
    await settle();
    expect(ask).not.toBeNull();
    act(() => root.unmount());
    expect(ask).toBeNull();
    root = createRoot(host);
  });
});
