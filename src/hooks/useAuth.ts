import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import type { AppSession, BackendKind } from "../lib/backend/types";

export interface AuthState {
  session: AppSession | null;
  loading: boolean;
  kind: BackendKind;
}

/** Tracks the auth session via the active backend (mock or supabase). */
export function useAuth(): AuthState {
  const [session, setSession] = useState<AppSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    backend.getSession().then((s) => {
      if (active) {
        setSession(s);
        setLoading(false);
      }
    });
    const unsub = backend.onAuthStateChange((s) => setSession(s));
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return { session, loading, kind: backend.kind };
}
