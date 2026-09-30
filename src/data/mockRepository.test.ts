import { describe, expect, it, beforeEach } from "vitest";
import type { Plan, Profile, WorkoutSession } from "../types";
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

  // ── Bug 1: two-tab clobber ───────────────────────────────────────────

  it("a write from one tab does not erase a write another tab already persisted", async () => {
    // Two live instances against the SAME localStorage (two browser tabs).
    const tabA = new MockRepository();
    await tabA.init();
    const tabB = new MockRepository();
    await tabB.init();

    // Tab A saves a workout and flushes.
    await tabA.saveWorkoutSession(aSession("s1", "2026-01-01"));

    // Tab B, still holding its OLDER in-memory snapshot (without A's workout),
    // now saves an unrelated profile change and flushes.
    await tabB.saveProfile(imperial());

    // Both writes must survive: B's flush must not have blind-overwritten the
    // whole document with its stale pre-A snapshot.
    const reopened = new MockRepository();
    await reopened.init();
    expect(await reopened.listWorkoutSessions()).toHaveLength(1);
    expect((await reopened.getProfile())?.units).toBe("imperial");
  });

  it("tab A's own workout survives even when read back through tab B", async () => {
    // Same setup as above, but assert on tabB directly (no reopen) — the
    // storage-event listener should also keep tabB's in-memory copy fresh.
    const tabA = new MockRepository();
    await tabA.init();
    const tabB = new MockRepository();
    await tabB.init();

    await tabA.saveWorkoutSession(aSession("s2", "2026-01-02"));
    await tabB.saveProfile(imperial());

    // tabB's own flush() re-reads localStorage immediately beforehand, so its
    // in-memory copy (and anything persisted) reflects A's workout too.
    expect(await tabB.listWorkoutSessions()).toHaveLength(1);
  });

  // ── Bug 2: a failed write must not resolve as success ───────────────

  it("rejects a mutation when both localStorage and the VFS mirror fail to persist", async () => {
    failNextLocalStorageWrites();
    const originalWrite = vfs.write;
    vfs.write = async () => {
      throw new Error("VFS mirror unavailable");
    };
    try {
      const repo = new MockRepository();
      await repo.init();
      await expect(repo.saveProfile(imperial())).rejects.toThrow();
    } finally {
      vfs.write = originalWrite;
    }
  });

  it("still resolves when localStorage fails but the VFS mirror succeeds", async () => {
    const repo = new MockRepository();
    await repo.init();
    failNextLocalStorageWrites();
    await expect(repo.saveProfile(imperial())).resolves.toBeUndefined();
  });
});

describe("MockRepository storage failures", () => {
  let ls: Map<string, string>;

  beforeEach(async () => {
    ls = installLocalStorage();
    await vfs.write("store.json", JSON.stringify({ v: 2 }));
  });

  it("keeps every later change, and survives a reload, after a localStorage write fails", async () => {
    const repo = new MockRepository();
    await repo.init();
    await repo.saveProfile(imperial());

    // Quota fills up: from here the VFS mirror is the only copy that lands.
    failNextLocalStorageWrites();
    await repo.saveWorkoutSession(aSession("a", "2026-01-05"));
    await repo.saveWorkoutSession(aSession("b", "2026-01-05"));

    // The second change must build on the first, not on the stale local copy.
    expect(await repo.listWorkoutSessions()).toHaveLength(2);
    expect(JSON.parse(await vfs.read("store.json")).workoutSessions).toHaveLength(2);

    const reopened = new MockRepository();
    await reopened.init();
    expect(await reopened.listWorkoutSessions()).toHaveLength(2);
    expect((await reopened.getProfile())?.units).toBe("imperial");
  });

  it("registers the cross-tab watcher when a local copy already exists", async () => {
    const listeners: Array<(e: { key: string; newValue: string | null }) => void> = [];
    const w = (globalThis as unknown as { window: Record<string, unknown> }).window;
    w.addEventListener = (_type: string, fn: (e: { key: string; newValue: string | null }) => void) => {
      listeners.push(fn);
    };

    const tabA = new MockRepository();
    await tabA.init(); // first run: no local copy yet
    await tabA.saveProfile(imperial());
    const tabB = new MockRepository();
    await tabB.init(); // local copy exists
    expect(listeners).toHaveLength(2);

    await tabA.saveWorkoutSession(aSession("c", "2026-01-05"));
    expect(await tabB.listWorkoutSessions()).toHaveLength(0);
    // The browser delivers the storage event to the other tab only.
    const key = [...ls.keys()][0]!;
    listeners[1]!({ key, newValue: ls.get(key)! });
    expect(await tabB.listWorkoutSessions()).toHaveLength(1);
  });

  describe("when the VFS store cannot be read on a device with no local copy", () => {
    let writes: Array<[string, string]>;
    let failReads: boolean;
    const synced = { v: 3, profile: null, plan: null, dayLogs: {}, workoutSessions: [] as unknown[] };

    beforeEach(() => {
      writes = [];
      failReads = true;
      (globalThis as unknown as { window: Record<string, unknown> }).window.__vfs = {
        exists: async () => true,
        read: async () => {
          if (failReads) throw new Error("vfs timeout");
          return JSON.stringify({ ...synced, workoutSessions: [aSession("synced", "2026-01-05")] });
        },
        write: async (path: string, content: string) => void writes.push([path, content]),
        ls: async () => [],
        mkdir: async () => {},
        rm: async () => {},
      };
    });

    it("does not pin an empty store locally or write it to the mirror", async () => {
      const repo = new MockRepository();
      await repo.init();
      expect(ls.size).toBe(0);
      expect(writes).toEqual([]);
    });

    it("fails the save loudly while the store is still unreadable, without writing anything", async () => {
      const repo = new MockRepository();
      await repo.init();
      await expect(repo.saveProfile(imperial())).rejects.toThrow();
      expect(ls.size).toBe(0);
      expect(writes).toEqual([]);
    });

    it("retries the read before the first write and keeps the synced data", async () => {
      const repo = new MockRepository();
      await repo.init();
      failReads = false;
      await repo.saveProfile(imperial());
      expect(await repo.listWorkoutSessions()).toHaveLength(1);
      const mirror = JSON.parse(writes[writes.length - 1]![1]);
      expect(mirror.workoutSessions).toHaveLength(1);
      expect(mirror.profile.units).toBe("imperial");
    });
  });
});

/** Make every subsequent `localStorage.setItem` throw, simulating a full
 *  quota or a browser with storage disabled mid-session. */
function failNextLocalStorageWrites(): void {
  const w = (globalThis as unknown as { window: { localStorage: Storage } }).window;
  w.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
}

function aSession(id: string, date: string): WorkoutSession {
  return {
    id,
    date,
    workoutName: "Full body",
    planned: [],
    actual: [],
    reprompts: [],
    completedAt: `${date}T08:00:00Z`,
    caloriesBurned: 250,
  };
}

const EMPTY_STORE = {
  v: 3 as const,
  profile: null,
  plan: null,
  dayLogs: {},
  workoutSessions: [],
};

describe("MockRepository upgrade from a Conjure Health-era store", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  const plan = (over: Record<string, unknown>) => ({
    id: "p1",
    durationWeeks: 4,
    startDate: "2026-09-01",
    endDate: "2026-09-28",
    safety: { ageBand: "18_39", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "moderate" },
    liability: { acknowledged: true, acceptedAt: "2026-09-01T00:00:00Z" },
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  });
  const v3 = (over: Record<string, unknown> = {}) => ({
    v: 3,
    profile: {
      ...DEFAULT_PROFILE,
      heightCm: 180,
      direction: "lose",
      goalWeightKg: 80,
      aiJournalConsent: { version: 1, acceptedAt: "2026-09-01T00:00:00Z", includeNotes: false },
    },
    goals: { calories: 2000, protein: 150, carbs: 200, fat: 60 },
    diary: [{ id: "d1", date: "2026-09-02", meal: "lunch", quantity: 1 }],
    weights: [{ date: "2026-09-02", weightKg: 90 }],
    sleep: [{ id: "s", date: "2026-09-02" }],
    water: [{ id: "w", date: "2026-09-02" }],
    symptoms: [{ id: "y", date: "2026-09-02" }],
    plan: plan({
      mode: "both",
      goals: [
        { id: "g1", label: "Hit your protein", kind: "nutrition" },
        { id: "g2", label: "Run 3x a week", kind: "workout" },
      ],
      targets: { dailyCalories: 2000 },
    }),
    dayLogs: { "2026-09-02": { date: "2026-09-02", checkoffs: {} } },
    workoutSessions: [aSession("kept", "2026-09-02")],
    ...over,
  });

  const open = async (doc: unknown) => {
    await vfs.write("store.json", JSON.stringify(doc));
    const repo = new MockRepository();
    await repo.init();
    return repo;
  };

  it("keeps the profile, plan, check-offs and workouts, and leaves the food data behind", async () => {
    const repo = await open(v3());
    expect(await repo.listWorkoutSessions()).toHaveLength(1);
    expect(await repo.getDayLog("2026-09-02")).not.toBeNull();
    await repo.saveProfile({ ...(await repo.getProfile())!, units: "imperial" });
    const stored = JSON.parse(await vfs.read("store.json"));
    // Still v3: an older build open elsewhere must be able to read it.
    expect(stored.v).toBe(3);
    expect(Object.keys(stored).sort()).toEqual(["dayLogs", "plan", "profile", "updatedAt", "v", "workoutSessions"]);
  });

  it("drops the profile fields only Conjure Health uses", async () => {
    const profile = (await (await open(v3())).getProfile()) as unknown as Record<string, unknown>;
    for (const k of ["heightCm", "direction", "goalWeightKg", "aiJournalConsent"]) {
      expect(profile).not.toHaveProperty(k);
    }
    expect(profile.weightKg).toBe(DEFAULT_PROFILE.weightKg);
  });

  it("reads a food plan as its training half, without food goals or targets", async () => {
    const p = (await (await open(v3())).getPlan()) as Plan & Record<string, unknown>;
    expect(p.mode).toBe("get_fit");
    expect(p.goals.map((g) => g.label)).toEqual(["Run 3x a week"]);
    expect(p).not.toHaveProperty("targets");
  });

  it("keeps a gated logging_only plan gated", async () => {
    const repo = await open(v3({ plan: plan({ mode: "logging_only", goals: [] }) }));
    expect((await repo.getPlan())?.mode).toBe("logging_only");
  });

  it("starts empty rather than guessing at a store from a future version", async () => {
    const repo = await open({ ...v3(), v: 4 });
    expect(await repo.getProfile()).toBeNull();
    expect(await repo.listWorkoutSessions()).toEqual([]);
  });
});
