import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Node test environment: give the bridge a window to live on.
const g = globalThis as unknown as { window?: unknown };
if (!g.window) g.window = globalThis;

const files: Record<string, string> = {};
const coachChat = vi.fn();

vi.mock("../../bridge/vfs", () => ({
  readJson: async (p: string, d: unknown) => (files[p] ? JSON.parse(files[p]) : d),
  writeJson: async (p: string, v: unknown) => {
    files[p] = JSON.stringify(v);
  },
}));
vi.mock("./context", () => ({ buildCoachContext: async () => ({ plan: null, profile: null, goals: {}, memory: {}, rendered: "" }) }));
vi.mock("./coach", () => ({ coachChat: (...a: unknown[]) => coachChat(...a) }));
let consentGranted = true;
vi.mock("../healthConsent", () => ({ healthConsentGranted: () => consentGranted }));

import {
  answerHubMessage,
  loadCoachHistory,
  onCoachThreadChange,
  recordCoachTurn,
  resetCoachThread,
  startCoachChatHub,
} from "./thread";

type Msg = { id: string; role: "user" | "assistant"; content: string; status?: string };

function installHub(opts: { listenOk?: boolean; messages?: Msg[] } = {}) {
  const messages: Msg[] = opts.messages ?? [];
  let handler: ((m: { threadId: string; messageId: string; content: string }) => Promise<string>) | null = null;
  const chat = {
    post: vi.fn(async (m: { role: "user" | "assistant"; content: string; threadId?: string; title?: string }) => {
      messages.push({ id: `m${messages.length}`, role: m.role, content: m.content });
      return { ok: true };
    }),
    history: vi.fn(async () => ({ ok: true, messages: [...messages] })),
    onMessage: vi.fn(async (fn: typeof handler) => {
      handler = fn;
      return opts.listenOk === false ? { ok: false, reason: "permission" } : { ok: true };
    }),
  };
  (window as unknown as { __conjureos: unknown }).__conjureos = { chat };
  return { chat, messages, deliver: (m: { threadId: string; messageId: string; content: string }) => handler!(m) };
}

beforeEach(() => {
  consentGranted = true;
  for (const k of Object.keys(files)) delete files[k];
  coachChat.mockReset();
  resetCoachThread();
});
afterEach(() => {
  delete (window as unknown as { __conjureos?: unknown }).__conjureos;
});

describe("coach thread on the ConjureOS chat hub", () => {
  it("without the hub, history is the app's own file and turns still save", async () => {
    files["coach-chat.json"] = JSON.stringify([{ role: "user", content: "hi" }]);
    expect(await startCoachChatHub()).toBe(false);
    expect(await loadCoachHistory()).toEqual([{ role: "user", content: "hi" }]);
    await recordCoachTurn(
      [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
      "a",
      { role: "assistant", content: "b" },
    );
    expect(JSON.parse(files["coach-chat.json"]!)).toHaveLength(2);
  });

  it("registers one handler, and reports a refused registration", async () => {
    const { chat } = installHub();
    expect(await startCoachChatHub()).toBe(true);
    expect(chat.onMessage).toHaveBeenCalledTimes(1);
    resetCoachThread();
    installHub({ listenOk: false });
    expect(await startCoachChatHub()).toBe(false);
  });

  it("posts both sides of an in-app turn to the main thread, titled Coach", async () => {
    const { chat } = installHub();
    await recordCoachTurn(
      [{ role: "user", content: "q" }, { role: "assistant", content: "r" }],
      "q",
      { role: "assistant", content: "r" },
    );
    expect(chat.post.mock.calls.map((c) => [c[0].threadId, c[0].role, c[0].content, c[0].title])).toEqual([
      ["main", "user", "q", "Coach"],
      ["main", "assistant", "r", "Coach"],
    ]);
    expect(JSON.parse(files["coach-chat.json"]!)).toHaveLength(2);
  });

  it("posts a proposal as readable text with its options", async () => {
    const { chat } = installHub();
    const reply = {
      role: "assistant" as const,
      content: "That looks heavy.",
      proposal: { question: "Drop a set?", type: "single" as const, options: [{ label: "Yes" }, { label: "No" }] },
    };
    await recordCoachTurn([{ role: "user", content: "q" }, reply], "q", reply);
    expect(chat.post.mock.calls[1]![0].content).toBe("That looks heavy.\n\nDrop a set?\nOptions: Yes / No");
  });

  it("copies an existing in-app conversation into an empty hub thread once", async () => {
    files["coach-chat.json"] = JSON.stringify([
      { role: "user", content: "old q" },
      { role: "assistant", content: "old a" },
    ]);
    const { chat } = installHub();
    expect(await loadCoachHistory()).toHaveLength(2);
    expect(await loadCoachHistory()).toHaveLength(2);
    expect(chat.post).toHaveBeenCalledTimes(2);
  });

  it("uses the hub thread when it holds more than the file, dropping pending and failed", async () => {
    installHub({
      messages: [
        { id: "1", role: "user", content: "from chat" },
        { id: "2", role: "assistant", content: "answer" },
        { id: "3", role: "user", content: "waiting", status: "pending" },
        { id: "4", role: "user", content: "broke", status: "failed" },
      ],
    });
    expect(await loadCoachHistory()).toEqual([
      { role: "user", content: "from chat" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("answers a ConjureChat message with coachChat and tells the app", async () => {
    files["coach-chat.json"] = JSON.stringify([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "earlier answer" },
    ]);
    const hub = installHub();
    coachChat.mockResolvedValue({ reply: "Rest tomorrow, then run easy." });
    await startCoachChatHub();
    const seen = vi.fn();
    onCoachThreadChange(seen);

    const reply = await hub.deliver({ threadId: "main", messageId: "x", content: "My legs are sore" });

    expect(reply).toBe("Rest tomorrow, then run easy.");
    const [sent, , opts] = coachChat.mock.calls[0]!;
    expect(sent.map((m: { content: string }) => m.content)).toEqual(["earlier", "earlier answer", "My legs are sore"]);
    expect(opts).toEqual({ answering: false, canPropose: true });
    expect(hub.chat.post).not.toHaveBeenCalled();
    expect(JSON.parse(files["coach-chat.json"]!)).toHaveLength(4);
    expect(seen).toHaveBeenCalledWith({ items: expect.any(Array) });
  });

  it("treats a ConjureChat message as the answer to a pending proposal and passes a plan change on", async () => {
    files["coach-chat.json"] = JSON.stringify([
      { role: "user", content: "too hard" },
      { role: "assistant", content: "", proposal: { question: "Drop a set?", type: "single", options: [{ label: "Yes" }] } },
    ]);
    installHub();
    const plan = { id: "p" };
    coachChat.mockResolvedValue({ reply: "Done.", planUpdate: { plan, summary: "one fewer set" } });
    const seen = vi.fn();
    onCoachThreadChange(seen);
    await answerHubMessage({ threadId: "main", messageId: "x", content: "Yes" });
    expect(coachChat.mock.calls[0]![2]).toEqual({ answering: true, canPropose: true });
    const saved = JSON.parse(files["coach-chat.json"]!);
    expect(saved[1].answered).toBe(true);
    expect(seen.mock.calls[0]![0].plan).toBe(plan);
  });

  it("answers from the hub's history when the app has no file of its own", async () => {
    installHub({ messages: [{ id: "1", role: "user", content: "shared" }, { id: "2", role: "assistant", content: "ok" }] });
    coachChat.mockResolvedValue({ reply: "r" });
    await answerHubMessage({ threadId: "main", messageId: "3", content: "q" });
    expect(coachChat.mock.calls[0]![0][0].content).toBe("shared");
  });
});

describe("without consent to collect health data", () => {
  it("answers a ConjureChat message without calling the AI or keeping anything", async () => {
    consentGranted = false;
    const reply = await answerHubMessage({ threadId: "main", messageId: "nc", content: "plan my week" });
    expect(reply).toMatch(/permission to keep health data/);
    expect(coachChat).not.toHaveBeenCalled();
  });
});
