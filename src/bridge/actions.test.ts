/**
 * What Conjure Fitness publishes to ConjureOS: exactly the actions package.json
 * declares, and nothing that edits a plan, the safety intake or history in bulk.
 * The actions' behaviour is tested in fitnessActions.test.ts.
 */
import { describe, it, expect } from "vitest";

type Handler = (params?: unknown) => Promise<unknown>;

async function published(): Promise<Record<string, Handler>> {
  let map: Record<string, Handler> = {};
  (globalThis as { window?: unknown }).window = {
    __conjureos: { actions: { register: async (m: Record<string, Handler>) => void (map = m) } },
  };
  const { registerActions } = await import("./actions");
  await registerActions();
  return map;
}

describe("registerActions", () => {
  it("registers exactly the actions package.json declares", async () => {
    const pkg = (await import("../../package.json")) as unknown as {
      default: { conjureos: { actions?: Record<string, unknown> } };
    };
    const declared = Object.keys(pkg.default.conjureos.actions ?? {}).sort();
    expect(Object.keys(await published()).sort()).toEqual(declared);
    expect(declared).toEqual(["listWorkouts", "logWorkout", "nextWorkout", "trainingSummary"]);
  });

  it("exposes no plan, safety, profile or bulk-clear writes", async () => {
    const actions = await published();
    for (const forbidden of ["savePlan", "clearPlan", "saveProfile", "clearHistory", "clearAllHistories", "setGoals"]) {
      expect(actions[forbidden]).toBeUndefined();
    }
  });

  it("does nothing outside ConjureOS", async () => {
    (globalThis as { window?: unknown }).window = {};
    const { registerActions } = await import("./actions");
    await expect(registerActions()).resolves.toBeUndefined();
  });
});
