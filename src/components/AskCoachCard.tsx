/**
 * "Ask about food" — the home-screen entry point to the nutrition Q&A.
 *
 * The rotating suggestions are the whole point of the card: an empty box with a
 * cursor teaches nobody what to type, so the placeholder cycles real questions
 * until the user engages with the field, then holds still so it can't change
 * under them mid-thought.
 */

import { useEffect, useRef, useState } from "react";
import { ASK_SUGGESTIONS } from "../features/coach/ask";
import { CoachIcon } from "./icons";

/** How long each suggestion stays up. Slow enough to finish reading one,
 *  quick enough that a second is seen before attention moves on. */
const ROTATE_MS = 3600;

export function AskCoachCard({ onAsk }: { onAsk: (question: string) => void }) {
  const [draft, setDraft] = useState("");
  const [i, setI] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Freeze the carousel once the field is focused or has text — a placeholder
  // swapping while someone is typing reads as a glitch.
  const rotating = !engaged && draft === "";
  useEffect(() => {
    if (!rotating) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % ASK_SUGGESTIONS.length), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [rotating]);

  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    setDraft("");
    setEngaged(false);
    inputRef.current?.blur();
    onAsk(q);
  };

  // An untouched field offers the visible suggestion as a one-tap question.
  const suggestion = ASK_SUGGESTIONS[i] ?? ASK_SUGGESTIONS[0]!;

  return (
    <section className="home-card ask-card" aria-label="Ask about food">
      <div className="home-card-head">
        <span className="home-card-title">
          <CoachIcon size={16} /> Ask about food
        </span>
      </div>

      <div className="ask-row">
        <input
          ref={inputRef}
          className="text-input ask-input"
          aria-label="Ask a question about food"
          value={draft}
          placeholder={suggestion}
          onFocus={() => setEngaged(true)}
          onBlur={() => setEngaged(draft !== "")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          className="btn primary ask-send"
          // With nothing typed the button asks whatever is on screen, so the
          // suggestions are usable rather than decorative.
          onClick={() => (draft.trim() ? submit() : onAsk(suggestion))}
        >
          Ask
        </button>
      </div>

      <div className="muted small ask-hint">
        Nutrition questions, answered. Your plan and diary stay untouched.
      </div>
    </section>
  );
}
