import { useRef, useState } from "react";
import type { DraftEntry, EntryKind } from "../lib/types";
import { parseEntries } from "../lib/api";

interface Props {
  onLogged: (drafts: DraftEntry[]) => Promise<void>;
}

/** Plain-language + photo logging. Parses via the AI function, then hands
 *  the drafts up to be saved. The user adjusts numbers afterward in the list. */
export default function LogInput({ onLogged }: Props) {
  const [kind, setKind] = useState<EntryKind>("food");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function logText() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const drafts = await parseEntries({ kind, text: trimmed });
      if (drafts.length === 0) throw new Error("Couldn't find anything to log — try rephrasing.");
      await onLogged(drafts);
      setText("");
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function logPhoto(file: File) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await toBase64(file);
      const drafts = await parseEntries({
        kind: "food",
        text: text.trim() || undefined,
        image: { media_type: file.type || "image/jpeg", data },
      });
      if (drafts.length === 0) throw new Error("Couldn't read the photo — try a clearer shot.");
      await onLogged(drafts);
      setText("");
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="logger card">
      <div className="seg">
        <button
          className={kind === "food" ? "seg-btn active" : "seg-btn"}
          onClick={() => setKind("food")}
        >
          Food
        </button>
        <button
          className={kind === "exercise" ? "seg-btn active" : "seg-btn"}
          onClick={() => setKind("exercise")}
        >
          Exercise
        </button>
      </div>

      <div className="logger-row">
        <textarea
          className="logger-input"
          rows={2}
          value={text}
          disabled={busy}
          placeholder={
            kind === "food"
              ? "chicken sandwich and a beer for lunch…"
              : "30 min run at a moderate pace…"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) logText();
          }}
        />
      </div>

      <div className="logger-actions">
        {kind === "food" && (
          <>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              📷 Photo
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) logPhoto(f);
              }}
            />
          </>
        )}
        <button className="btn btn-primary log-btn" disabled={busy || !text.trim()} onClick={logText}>
          {busy ? "Logging…" : "Log it"}
        </button>
      </div>

      <p className="logger-hint">
        Describe it naturally — we estimate the rest. You can tweak the numbers after.
      </p>
      {error && <p className="notice notice-err">{error}</p>}
    </section>
  );
}

function humanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "ai_request_failed") return "The AI was unavailable. Try again in a moment.";
  if (msg === "ai_no_structured_output") return "Couldn't structure that — try rephrasing.";
  if (msg === "authentication required") return "Your session expired — sign in again.";
  return msg;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Couldn't read the image."));
    reader.readAsDataURL(file);
  });
}
