/**
 * ConjureOS Chat's own yes or no (features/chatConsent.ts, PM decision
 * 2026-11-06, ConjureOS #1230), modeled on Conjure Health's purpose "chat"
 * sheet. It says what Chat can read and what it cannot before the person
 * answers. Allow and Don't allow are both answers and both are recorded;
 * tapping outside is no answer and records nothing.
 *
 * Opened by App when ConjureOS Chat asks for it (`asked`) and from Settings'
 * Allow. App only opens it while the agreement to keep health data is in
 * place, and checks again before an Allow is saved.
 */

import { useState } from "react";
import { useScrollLock } from "../hooks/useScrollLock";
import {
  CHAT_ASKED,
  CHAT_CHOICE,
  CHAT_INTRO,
  CHAT_READS,
  CHAT_TITLE,
  CHAT_WITHHOLDS,
} from "../features/chatConsentCopy";

export function ChatConsentSheet({
  asked,
  notice,
  onAllow,
  onDontAllow,
  onDismiss,
}: {
  /** ConjureOS Chat asked for it, so the sheet says so first. */
  asked: boolean;
  /** A line said as an alert (an Allow that could not be saved). */
  notice?: string;
  onAllow: () => void;
  onDontAllow: () => void;
  /** Tapping outside: no answer. */
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useScrollLock();

  return (
    <div className="sheet-backdrop" onClick={onDismiss}>
      <div
        className="sheet chat-consent"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-consent-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2 id="chat-consent-title">{CHAT_TITLE}</h2>
        </header>

        <div className="sheet-body">
          {asked && <p>{CHAT_ASKED}</p>}
          <p className="muted small">{CHAT_INTRO}</p>

          <div className="section-label">What Chat can read</div>
          <ul className="consent-list">
            {CHAT_READS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <div className="section-label">What it cannot</div>
          <ul className="consent-list withheld">
            {CHAT_WITHHOLDS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <p className="muted small">{CHAT_CHOICE}</p>

          {notice && (
            <p className="notice notice-error" role="alert">
              {notice}
            </p>
          )}
        </div>

        <footer className="sheet-foot consent-foot">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onDontAllow();
            }}
          >
            Don't allow
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onAllow();
            }}
          >
            Allow
          </button>
        </footer>
      </div>
    </div>
  );
}
