/**
 * Host identity bridge.
 *
 * The single-sign-on contract for keystone apps: ConjureOS owns the user's
 * session against the *shared* Supabase project, and hands keystone apps a
 * usable access token + identity so they never prompt for a second login.
 *
 * This is exposed by ConjureOS as `window.__conjureos.auth` and gated behind
 * an `auth.identity` permission (first-party keystone apps only). When the
 * bridge is absent — `npm run dev`, an older host, or a permission the user
 * declined — `getAccessToken()` resolves to null and the data layer falls back
 * to the mock, so the app stays fully usable offline.
 */

export interface HostUser {
  id: string;
  email?: string;
}

declare global {
  interface ConjureosBridge {
    auth?: {
      /** The signed-in user, or null when signed out. */
      getUser?: () => Promise<HostUser | null>;
      /** A Supabase access token valid against the shared project, or null. */
      getAccessToken?: () => Promise<string | null>;
    };
    /** Read-only mirror ConjureOS already injects today. */
    signedIn?: boolean;
  }
}

function authBridge() {
  return window.__conjureos?.auth;
}

/** True when the host can supply a real session token (SSO available). */
export function isHostAuthAvailable(): boolean {
  return typeof authBridge()?.getAccessToken === "function";
}

/** Coarse signed-in mirror that every ConjureOS version exposes. */
export function isSignedIn(): boolean {
  return window.__conjureos?.signedIn === true;
}

export async function getHostUser(): Promise<HostUser | null> {
  const fn = authBridge()?.getUser;
  if (!fn) return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  const fn = authBridge()?.getAccessToken;
  if (!fn) return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}
