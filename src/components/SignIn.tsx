import { useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

type Mode = "magic" | "password";

/** Sign-in screen. Reuses ConjureOS auth: magic-link, password, or Google. */
export default function SignIn() {
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const configured = isSupabaseConfigured();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setStatus("Check your email for a sign-in link.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (!supabase) return;
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
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

        {!configured && (
          <p className="notice notice-warn">
            Supabase isn't configured yet. Set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> (same project as ConjureOS) to enable sign-in.
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
              disabled={!configured || busy}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
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
                disabled={!configured || busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          <button type="submit" className="btn btn-primary" disabled={!configured || busy}>
            {busy ? "…" : mode === "magic" ? "Email me a link" : "Sign in"}
          </button>
        </form>

        <button className="btn btn-ghost" onClick={google} disabled={!configured || busy}>
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
