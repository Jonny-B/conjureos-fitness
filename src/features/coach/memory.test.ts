import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vfs } from "../../bridge/vfs";
import { SAVE_FAILED_EVENT } from "../../data/saveFailure";
import { EMPTY_MEMORY } from "./model";
import { loadMemory, remember } from "./memory";

describe("coach memory", () => {
  let seen: string[];
  beforeEach(async () => {
    seen = [];
    const events = new EventTarget();
    events.addEventListener(SAVE_FAILED_EVENT, (e) =>
      seen.push((e as CustomEvent<{ message: string }>).detail.message),
    );
    (globalThis as unknown as { window: unknown }).window = events;
    await vfs.rm("coach.json");
  });
  afterEach(() => vi.restoreAllMocks());

  it("never hands out the shared EMPTY_MEMORY, so a reset really forgets", async () => {
    expect(await loadMemory()).not.toBe(EMPTY_MEMORY);
    await remember({ notes: ["hates burpees"], summary: "s" });
    await vfs.rm("coach.json"); // Settings -> Reset data
    const after = await loadMemory();
    expect(after.notes).toEqual([]);
    expect(after.summary).toBeUndefined();
    expect(EMPTY_MEMORY).toEqual({ v: 1, notes: [], events: [], metrics: [] });
  });

  it("does not replace remembered notes when coach.json cannot be read", async () => {
    await remember({ notes: ["knee is cranky"] });
    const before = await vfs.read("coach.json");
    vi.spyOn(vfs, "read").mockRejectedValue(new Error("vfs timeout"));
    const m = await remember({ notes: ["likes rowing"] });
    expect(m.notes).toEqual(["likes rowing"]);
    expect(seen).toHaveLength(1);
    expect((await loadMemory()).notes).toEqual([]);
    vi.restoreAllMocks();
    expect(await vfs.read("coach.json")).toBe(before);
  });

  it("fills in missing events and metrics arrays", async () => {
    await vfs.write("coach.json", JSON.stringify({ v: 1, notes: ["a"] }));
    const m = await loadMemory();
    expect(m.events).toEqual([]);
    expect(m.metrics).toEqual([]);
  });
});
