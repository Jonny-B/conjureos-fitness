/**
 * "Something outside the UI just changed the data."
 *
 * The app's own screens bump App's `nonce` after a write, but a write that
 * arrives through a cross-app action (another app, or the assistant, logging a
 * workout) happens outside React entirely. Without a signal, an open Workouts
 * tab kept showing the old day until the user navigated away and back.
 * Actions call `notifyDataChanged()` after a successful write; App listens and
 * refreshes.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe function. */
export function onDataChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Tell every subscriber the stored data changed. A throwing subscriber never
 *  stops the others, and never fails the write that triggered it. */
export function notifyDataChanged(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a listener's problem, not the writer's */
    }
  }
}
