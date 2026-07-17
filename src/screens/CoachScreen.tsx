import { useEffect, useRef, useState } from "react";
import type { Plan } from "../types";
import type { ChatMessage } from "../bridge/ai";
import { readJson, writeJson } from "../bridge/vfs";
import { buildCoachContext } from "../features/coach/context";
import { coachChat } from "../features/coach/coach";
import type { CoachContext } from "../features/coach/model";

const CHAT_PATH = "coach-chat.json";
const MAX_STORED = 40;

/**
 * Chat with your trainer — the app-wide coach surface. The coach sees the
 * user's real data (context.ts) + its memory, replies in character, and can
 * apply small validated plan updates mid-conversation. History persists to
 * the VFS so the relationship feels continuous across sessions.
 */
export function CoachScreen({
  onPlanChange,
  initialPrompt,
}: {
  onPlanChange: (plan: Plan) => void;
  /** A question submitted from the Plan tab's coach launcher — sent once on
   *  mount so the user lands in an already-started conversation. */
  initialPrompt?: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const ctxRef = useRef<CoachContext | null>(null);
  const busyRef = useRef(false);
  const sentInitialRef = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [history, ctx] = await Promise.all([
        readJson<ChatMessage[]>(CHAT_PATH, []),
        buildCoachContext(),
      ]);
      if (!alive) return;
      ctxRef.current = ctx;
      const base = Array.isArray(history) ? history : [];
      setMessages(base);
      // Auto-submit the launcher question (once) so the chat opens mid-answer.
      const q = initialPrompt?.trim();
      if (q && !sentInitialRef.current) {
        sentInitialRef.current = true;
        void sendText(q, base);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  // Send `text` appended to `base`, resolving the coach reply. Shared by the
  // input row (base = current thread) and the mount-time auto-submit (base =
  // the just-loaded history), so a stale `messages` closure can't drop it.
  const sendText = async (text: string, base: ChatMessage[]) => {
    const t = text.trim();
    if (!t || busyRef.current) return;
    const withUser: ChatMessage[] = [...base, { role: "user", content: t }];
    setMessages(withUser);
    busyRef.current = true;
    setBusy(true);
    try {
      // Context is rebuilt lazily per send so the coach sees today's data,
      // and after a plan update so it doesn't argue with its own change.
      const ctx = ctxRef.current ?? (await buildCoachContext());
      const outcome = await coachChat(withUser, ctx);
      if (outcome.planUpdate) {
        onPlanChange(outcome.planUpdate.plan);
        ctxRef.current = await buildCoachContext();
      }
      const next: ChatMessage[] = [...withUser, { role: "assistant", content: outcome.reply }];
      setMessages(next);
      await writeJson(CHAT_PATH, next.slice(-MAX_STORED));
    } catch {
      setMessages([
        ...withUser,
        { role: "assistant", content: "Sorry — I couldn't reach the AI service just now. Try again in a moment." },
      ]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy || messages == null) return;
    setDraft("");
    void sendText(text, messages);
  };

  if (messages == null) {
    return (
      <div className="center-fill">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="coach-screen">
      <div className="coach-thread">
        {messages.length === 0 && (
          <div className="coach-empty">
            <h2>Your coach</h2>
            <p className="muted">
              Ask anything — form checks, swaps, motivation, what to eat before a workout. Your coach can
              see your plan, food, weight, and workout history, and can adjust your program for you.
            </p>
            <div className="coach-suggestions">
              {["How am I doing this week?", "This plan feels too hard", "What should I focus on tomorrow?"].map(
                (s) => (
                  <button key={s} className="chip" onClick={() => setDraft(s)}>
                    {s}
                  </button>
                ),
              )}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`coach-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="coach-msg assistant typing">…</div>}
        <div ref={endRef} />
      </div>

      <div className="coach-input-row">
        <textarea
          className="text-input coach-input"
          rows={1}
          value={draft}
          placeholder="Message your coach"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn primary" onClick={() => void send()} disabled={busy || !draft.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
