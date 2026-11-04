/**
 * ConjureOS #1230: a model read that lands before the gate has read the
 * consent file is answered, not refused. Runs the real healthConsent, with
 * only the file reads held back.
 */
import { describe, it, expect, vi } from "vitest";

let releaseFirst: (() => void) | null = null;
let reads = 0;
const record = JSON.stringify({ acceptedAt: "2026-01-01T00:00:00Z", version: 1 });

vi.mock("./vfs", () => ({
  readJson: async <T,>(path: string, fallback: T): Promise<T> => {
    if (path !== "health-consent.json") return fallback;
    reads += 1;
    // The gate's own read comes first and is the slow one.
    if (reads === 1) await new Promise<void>((r) => (releaseFirst = r));
    return JSON.parse(record) as T;
  },
  writeJsonOrThrow: async () => {},
}));
vi.mock("../data/repository", () => ({
  getRepository: async () => new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : async () => []) }),
}));

describe("a model read before the gate has settled", () => {
  it("is answered when the agreement is on file", async () => {
    type Handler = (params?: unknown) => Promise<unknown>;
    let actions: Record<string, Handler> = {};
    (globalThis as { window?: unknown }).window = {
      __conjureos: { actions: { register: async (m: Record<string, Handler>) => void (actions = m) } },
    };
    const { loadHealthConsent } = await import("../features/healthConsent");
    const { registerActions } = await import("./actions");
    void loadHealthConsent();
    await registerActions();
    const result = await Promise.race([
      actions.listWorkouts!({ __caller: { forModel: true } }).then(() => "answered", (e: Error) => e.message),
      new Promise((r) => setTimeout(() => r("held"), 200)),
    ]);
    releaseFirst?.();
    expect(result).toBe("answered");
  });
});
