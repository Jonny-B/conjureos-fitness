import { describe, expect, it, beforeEach } from "vitest";
import type { Profile } from "../types";
import { DEFAULT_PROFILE } from "../types";
import { vfs } from "../bridge/vfs";
import { MockRepository } from "./mockRepository";

// node env has no window/localStorage — back it with a tiny Map-based Storage
// so the device-local persistence path is exercised.
function installLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  (globalThis as unknown as { window: { localStorage: unknown } }).window = {
    localStorage: storage,
  };
  return map;
}

const imperial = (): Profile => ({ ...DEFAULT_PROFILE, units: "imperial" });

describe("MockRepository device-local persistence", () => {
  let ls: Map<string, string>;

  beforeEach(async () => {
    ls = installLocalStorage();
    // Wipe the shared in-memory VFS mirror between tests.
    await vfs.write("store.json", JSON.stringify({ v: 2 }));
  });

  it("keeps a device-local write across a reopen even when the synced VFS blob is stale", async () => {
    // 1. Save imperial units and let it flush to both localStorage + VFS.
    const repo = new MockRepository();
    await repo.init();
    await repo.saveProfile(imperial());
    expect(ls.size).toBeGreaterThan(0);

    // 2. Simulate a stale cloud pull: another surface's blind flush overwrites
    //    the synced VFS store.json with an OLD metric profile.
    await vfs.write(
      "store.json",
      JSON.stringify({ ...EMPTY_STORE, profile: { ...DEFAULT_PROFILE, units: "metric" } }),
    );

    // 3. Reopen the app (fresh repository instance) → must read the device-local
    //    authoritative copy, NOT the stale synced blob.
    const reopened = new MockRepository();
    await reopened.init();
    const p = await reopened.getProfile();
    expect(p?.units).toBe("imperial");
  });

  it("seeds from the VFS mirror on a fresh device (empty localStorage)", async () => {
    // A device with no local copy but a synced store.json should adopt it once.
    await vfs.write(
      "store.json",
      JSON.stringify({ ...EMPTY_STORE, profile: { ...DEFAULT_PROFILE, units: "imperial" } }),
    );
    ls.clear();

    const repo = new MockRepository();
    await repo.init();
    expect((await repo.getProfile())?.units).toBe("imperial");
    // …and pins it locally so the next load is device-authoritative.
    expect(ls.size).toBeGreaterThan(0);
  });

  it("degrades to the VFS mirror when localStorage is disabled (private mode)", async () => {
    // window exists but touching localStorage throws — the real private-mode /
    // blocked-storage case. Persistence must fall back to the VFS mirror.
    (globalThis as unknown as { window: object }).window = {
      get localStorage(): unknown {
        throw new Error("storage disabled");
      },
    };
    const repo = new MockRepository();
    await repo.init();
    await repo.saveProfile(imperial());
    const reopened = new MockRepository();
    await reopened.init();
    expect((await reopened.getProfile())?.units).toBe("imperial");
  });
});

const EMPTY_STORE = {
  v: 2 as const,
  profile: null,
  goals: null,
  diary: [],
  weights: [],
  plan: null,
  dayLogs: {},
  workoutSessions: [],
};
