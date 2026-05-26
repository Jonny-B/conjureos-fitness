import { useState } from "react";
import { backend, isDemo } from "../lib/backend";

type Mode = "magic" | "password";

/** Sign-in screen. Routes through the active backend's auth, so it works
 *  identically in demo mode (any credentials succeed) and against real
 *  ConjureOS auth (magic-link / password / Google). */
export default function SignIn() {
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (mode === "magic") {
        const { message } = await backend.signInWithOtp(email);
        if (message) setStatus(message);
      } else {
        await backend.signInWithPassword(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    setBusy(true);
    try {
      await backend.signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◗</span>
          <div>
            <h1>ConjureOS Fitness</h1>
            <p className="tagline">The calorie tracker that doesn't suck to log.</p>
          </div>
        </div>

        {isDemo && (
          <p className="notice notice-warn">
            <strong>Demo mode.</strong> Running on in-browser mock data — no backend needed.
            Sign in with any email (or just hit the button).
          </p>
        )}

        <form onSubmit={submit} className="signin-form">
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isDemo ? "anything@demo.dev" : "you@example.com"}
            />
          </label>

          {mode === "password" && (
            <label>
              Password
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "…" : isDemo ? "Enter demo" : mode === "magic" ? "Email me a link" : "Sign in"}
          </button>
        </form>

        <button className="btn btn-ghost" onClick={google} disabled={busy}>
          Continue with Google
        </button>

        <button
          className="link-btn"
          onClick={() => {
            setMode(mode === "magic" ? "password" : "magic");
            setError(null);
            setStatus(null);
          }}
        >
          {mode === "magic" ? "Use a password instead" : "Use a magic link instead"}
        </button>

        {status && <p className="notice notice-ok">{status}</p>}
        {error && <p className="notice notice-err">{error}</p>}
      </div>
    </div>
  );
}
