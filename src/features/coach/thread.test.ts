import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Node test environment: give the bridge a window to live on.
const g = globalThis as unknown as { window?: unknown };
if (!g.window) g.window = globalThis;

const files: Record<string, string> = {};

vi.mock("../../bridge/vfs", () => ({
  readJson: async (p: string, d: unknown) => (files[p] ? JSON.parse(files[p]) : d),
  writeJson: async (p: string, v: unknown) => {
    files[p] = JSON.stringify(v);
  },
}));

import { MAX_STORED, loadCoachHistory, recordCoachTurn } from "./thread";

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
});
afterEach(() => {
  delete (window as unknown as { __conjureos?: unknown }).__conjureos;
});

/**
 * The coach lives in the Coach tab only. ConjureOS removed the app chat hub
 * (#513): no app takes a place in its Chat panel, so the coach neither posts
 * to nor listens on a `chat` bridge, even where an older shell offers one.
 */
describe("the coach conversation", () => {
  it("is the app's own file, read back and saved", async () => {
    files["coach-chat.json"] = JSON.stringify([{ role: "user", content: "hi" }]);
    expect(await loadCoachHistory()).toEqual([{ role: "user", content: "hi" }]);
    await recordCoachTurn([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
    expect(JSON.parse(files["coach-chat.json"]!)).toHaveLength(2);
  });

  it("keeps the most recent turns only", async () => {
    const many = Array.from({ length: MAX_STORED + 5 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    await recordCoachTurn(many);
    const saved = JSON.parse(files["coach-chat.json"]!);
    expect(saved).toHaveLength(MAX_STORED);
    expect(saved[0].content).toBe("m5");
  });

  it("never touches a chat bridge an older shell still offers", async () => {
    const chat = { post: vi.fn(), history: vi.fn(), threads: vi.fn(), onMessage: vi.fn() };
    (window as unknown as { __conjureos: unknown }).__conjureos = { chat };
    await loadCoachHistory();
    await recordCoachTurn([{ role: "user", content: "q" }, { role: "assistant", content: "r" }]);
    for (const fn of Object.values(chat)) expect(fn).not.toHaveBeenCalled();
  });

  it("the manifest asks for no place in the Chat panel", async () => {
    const pkg = (await import("../../../package.json")) as unknown as { conjureos: { permissions: string[] } };
    expect(pkg.conjureos.permissions).not.toContain("chat");
    expect(pkg.conjureos).not.toHaveProperty("chat");
  });
});
