/**
 * Conjure Health is locked to Winter, and does not follow the ConjureOS theme.
 *
 * WHY A LOCK AT ALL, given ConjureOS lets people pick one of nine palettes and
 * every other app follows it: this app is read at a glance, mid-set or
 * mid-meal, and most of what it shows is a number against a target. Its
 * charts, rings and status bands are tuned against one ground, and "over
 * target" has to stay legible in a way that survives nobody reviewing it in
 * the other seventeen combinations. Winter's cool, low-chroma palette leaves
 * the warm end of the spectrum free for exactly that signal. Halloween's
 * orange would fight it.
 *
 * WHAT LOCKED DOES NOT MEAN. The app still RECEIVES the OS appearance — the
 * shell injects it at boot and broadcasts every change, and we read both, so
 * `hostAppearance()` can answer "what is ConjureOS wearing" for anything that
 * wants to know. It is simply never applied. Ignoring the handshake entirely
 * would look the same today and be a different thing: a lock is a decision
 * about this app's design, not an opt-out of the platform.
 *
 * The mirror of `@conjureos/ui`'s `ConjureTheme.init({ theme, flavor, lock:
 * true })`, written here as a typed module for the same reason Recipes has
 * one: `theme.js` installs a browser global from a <script> tag, and nothing
 * in a Vite + TypeScript app should be reaching for one of those.
 *
 * To unlock later, this becomes the ladder Recipes has (`src/theme.ts`
 * there) plus a settings control. Nothing else in the app reads these
 * attributes directly, so that change stays contained to this file.
 */

/** The palette Conjure Health is designed against. */
export const LOCKED_THEME = "win";
/** And the flavor. Dark, which is what the app has always been. */
export const LOCKED_FLAVOR = "dark";

const MSG = "conjureos:theme";

const THEME_IDS = ["cnj", "hal", "fal", "win", "spr", "sum", "xms", "est", "cnd"];

export interface HostAppearance {
  /** What ConjureOS is wearing. null means it has no override (Conjure). */
  theme: string | null;
  /** null means ConjureOS follows the browser's light/dark preference. */
  flavor: string | null;
  /** False outside the shell — `npm run dev`, or a standalone build. */
  inConjureOS: boolean;
}

const host: HostAppearance = { theme: null, flavor: null, inConjureOS: false };

const asTheme = (v: unknown): string | null =>
  typeof v === "string" && THEME_IDS.includes(v) ? v : null;

const asFlavor = (v: unknown): string | null => (v === "dark" || v === "light" ? v : null);

/**
 * What ConjureOS is wearing right now, for anything that wants to report it.
 * Never what this app is wearing — that is always Winter dark.
 */
export const hostAppearance = (): HostAppearance => ({ ...host });

/**
 * Forget what the host said. Only `theme.test.ts` calls this — the app has
 * one instance for its whole life, but a test file needs each case to start
 * from "nothing has been received yet".
 */
export const resetHostAppearance = (): void => {
  host.theme = null;
  host.flavor = null;
  host.inConjureOS = false;
};

/**
 * Pin the palette and start listening.
 *
 * Call before React mounts. The attributes are written even though
 * `index.html` also carries them, so the single-file inline build (which
 * generates its own shell) is pinned too — the same reason `main.tsx` sets
 * the `cui-ui` body class at runtime.
 *
 * `win` defaults to the real window and is only ever passed by the tests,
 * which hand it a fake rather than pulling jsdom in for one file.
 */
export function initAppearance(win: Window & typeof globalThis = window): void {
  const el = win.document.documentElement;
  el.setAttribute("data-theme", LOCKED_THEME);
  el.setAttribute("data-flavor", LOCKED_FLAVOR);

  try {
    const injected = (win as unknown as {
      __conjureos?: { appearance?: { theme?: unknown; flavor?: unknown } };
    }).__conjureos?.appearance;
    if (injected) {
      host.inConjureOS = true;
      host.theme = asTheme(injected.theme);
      host.flavor = asFlavor(injected.flavor);
    }
  } catch {
    /* no host bridge: standalone, and there is nothing to record */
  }

  win.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data as { type?: unknown; theme?: unknown; flavor?: unknown } | null;
    if (!data || data.type !== MSG) return;
    // Only the embedder can speak for ConjureOS. With no embedder at all —
    // this window is its own parent — there is no ConjureOS to speak for it,
    // so we reject before even checking who sent the message.
    const embedded = win.parent && win.parent !== win;
    if (!embedded) return;
    if (ev.source !== win.parent) return;
    host.inConjureOS = true;
    host.theme = asTheme(data.theme);
    host.flavor = asFlavor(data.flavor);
    // Deliberately no re-apply. This is the whole point of the lock.
  });

  // Announce ourselves anyway, so the shell answers with its current
  // appearance even if it booted first. We want the value; we just don't
  // wear it.
  try {
    if (win.parent && win.parent !== win) {
      win.parent.postMessage({ type: `${MSG}:subscribe` }, "*");
    }
  } catch {
    /* a cross-origin parent that refuses. Not fatal. */
  }
}
