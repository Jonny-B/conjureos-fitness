/**
 * Publishes Conjure Fitness's cross-app actions to ConjureOS.
 *
 * The handlers live in fitnessActions.ts and ACTIONS.md is their contract. The
 * `conjureos.actions` block in package.json is the schema the host checks
 * against, so the two must name exactly the same actions (actions.test.ts
 * holds them together).
 */

import { FITNESS_ACTIONS } from "./fitnessActions";

declare global {
  interface ConjureosBridge {
    actions?: {
      register?: (handlers: Record<string, (params?: unknown) => Promise<unknown>>) => Promise<void>;
    };
  }
}

/** Register the actions with the host. A no-op outside ConjureOS or on a host too old to have actions. */
export async function registerActions(): Promise<void> {
  const bridge = window.__conjureos?.actions;
  if (!bridge?.register) return;
  await bridge.register({ ...FITNESS_ACTIONS });
}
