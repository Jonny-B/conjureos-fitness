// @vitest-environment jsdom
/**
 * The coach's screens keep nothing from an answer that lands after consent to
 * keep health data was withdrawn (conjureos-fitness#96, ConjureOS #1163):
 * CoachScreen does not record the turn or hand back a plan change, and the
 * food questions sheet does not save its conversation. Driven through the
 * real screens; only the AI call, the files, the stored profile and plan and
 * the coach's context are stand-ins.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Plan, Profile } from "../types";
import { DEFAULT_GOALS } from "../types";
import { EMPTY_MEMORY, type CoachContext } from "../features/coach/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const complete = vi.fn();
const files: Record<string, string> = {};

vi.mock("../bridge/ai", async (orig) => ({
  ...(await orig<typeof import("../bridge/ai")>()),
  complete: (...a: unknown[]) => complete(...a),
  isAiAvailable: () => true,
}));
vi.mock("../bridge/vfs", () => ({
  readJson: async (p: string, d: unknown) => (files[p] ? JSON.parse(files[p]!) : d),
  writeJson: async (p: string, v: unknown) => void (files[p] = JSON.stringify(v)),
  writeJsonOrThrow: async (p: string, v: unknown) => void (files[p] = JSON.stringify(v)),
  vfs: { rm: async (p: string) => void delete files[p] },
}));

let profile: Profile;
const plans: Plan[] = [];
vi.mock("../data/repository", () => ({
  getRepository: async () => ({
    getProfile: async () => profile,
    saveProfile: async (p: Profile) => void (profile = p),
    savePlan: async (p: Plan) => void plans.push(p),
    saveGoals: async () => {},
    getGoals: async () => DEFAULT_GOALS,
    listDiary: async () => [],
    listWater: async () => [],
    listSleep: async () => [],
    listSymptoms: async () => [],
    listWeights: async () => [],
  }),
}));

const PLAN = {
  id: "p",
  mode: "get_fit",
  durationWeeks: 4,
  startDate: "2026-10-01",
  endDate: "2026-10-28",
  goals: [],
  safety: { ageBand: "18_39", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "active" },
  liability: { acknowledged: true, acceptedAt: "2026-10-01T00:00:00Z" },
  createdAt: "2026-10-01T00:00:00Z",
  program: {
    workouts: [
      {
        id: "pw",
        group: 2,
        workout: {
          id: "w",
          name: "Leg Day",
          exercises: [{ id: "e", name: "Squat", sets: [{ reps: 10, durationSec: null, restSec: 60 }] }],
          origin: "built-in",
        },
      },
    ],
    benchmarks: [
      { id: "b", exerciseKey: "squat", name: "Squat", metric: "reps", baseline: 8, target: 20, unit: "reps", history: [] },
    ],
    analysisCursor: 0,
  },
} as unknown as Plan;

vi.mock("../features/coach/context", async (orig) => ({
  ...(await orig<typeof import("../features/coach/context")>()),
  buildCoachContext: async (): Promise<CoachContext> => ({
    plan: PLAN,
    profile,
    goals: DEFAULT_GOALS,
    memory: EMPTY_MEMORY,
    rendered: "Program exercises (use these exact keys): squat.",
  }),
}));

const ADJUST = '<adjust>{ "summary": "Lighter squats", "changes": [ { "op": "setReps", "exerciseKey": "squat", "reps": 8 } ] }</adjust>';
const REMEMBER = '<remember>{ "notes": ["Trains early"] }</remember>';

let container: HTMLDivElement;
let root: Root;
let collection: typeof import("../features/healthConsent");

beforeEach(async () => {
  vi.resetModules();
  Element.prototype.scrollIntoView = () => {};
  complete.mockReset();
  for (const k of Object.keys(files)) delete files[k];
  plans.length = 0;
  profile = {
    sex: "female", age: 34, heightCm: 168, weightKg: 70, activityLevel: "moderate",
    direction: "maintain", units: "metric",
  };
  // The coach is reachable only once the person agreed to keep health data.
  files["health-consent.json"] = JSON.stringify({ acceptedAt: "2026-09-01T09:00:00.000Z", version: 1 });
  collection = await import("../features/healthConsent");
  expect(await collection.loadHealthConsent()).toBe(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(el: ReactElement) {
  act(() => root.render(el));
  await settle();
}

/** Answer the request that is out, after the person withdraws, or not. */
function pending(): { answer: (s: string) => Promise<void> } {
  let resolve!: (s: string) => void;
  complete.mockImplementation(() => new Promise<string>((r) => (resolve = r)));
  return {
    answer: async (s: string) => {
      await act(async () => resolve(s));
      await settle();
    },
  };
}

async function withdraw() {
  await act(async () => {
    await collection.withdrawHealthConsent();
  });
  await settle();
}

describe("CoachScreen", () => {
  async function coach(onPlanChange: (p: Plan) => void, prompt: string) {
    const { CoachScreen } = await import("./CoachScreen");
    await render(<CoachScreen onPlanChange={onPlanChange} initialPrompt={prompt} />);
  }

  it("records no turn and hands back no plan from an answer that lands after the withdrawal", async () => {
    const out = pending();
    const onPlanChange = vi.fn();
    await coach(onPlanChange, "I train early, and make the squats lighter");
    expect(complete).toHaveBeenCalledTimes(1);

    await withdraw();
    await out.answer(`Done. ${REMEMBER}`);
    expect(files["coach-chat.json"]).toBeUndefined();
    expect(files["coach.json"]).toBeUndefined();
    expect(onPlanChange).not.toHaveBeenCalled();
  });

  it("records the turn when nothing changed (positive control)", async () => {
    const out = pending();
    await coach(() => {}, "I train early");
    await out.answer(`Noted. ${REMEMBER}`);
    expect(JSON.parse(files["coach-chat.json"]!)).toHaveLength(2);
  });
});

describe("the coach's answer to a proposal", () => {
  it("applies nothing when the withdrawal lands first", async () => {
    const onPlanChange = vi.fn();
    // The conversation so far ends on a proposal, so the next message answers it.
    files["coach-chat.json"] = JSON.stringify([
      { role: "user", content: "legs are cooked" },
      {
        role: "assistant",
        content: "How should we ease off?",
        proposal: { question: "How should we ease off?", type: "single", options: [{ label: "Lighter squats" }] },
      },
    ]);
    const out = pending();
    const { CoachScreen } = await import("./CoachScreen");
    await render(<CoachScreen onPlanChange={onPlanChange} />);
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>("[placeholder='Message your coach']")!;
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, "Lighter squats");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Send")!.click());
    await settle();
    expect(complete).toHaveBeenCalledTimes(1);

    await withdraw();
    await out.answer(`Done. ${ADJUST}`);
    expect(plans).toEqual([]);
    expect(onPlanChange).not.toHaveBeenCalled();
  });
});

describe("the food questions sheet", () => {
  it("saves no conversation from an answer that lands after the withdrawal", async () => {
    const { recordAiJournalConsent } = await import("../features/aiConsent");
    expect(await recordAiJournalConsent(false)).toBe(true);
    const out = pending();
    const { CoachChatModal } = await import("../components/CoachChatModal");
    await render(<CoachChatModal initialQuestion="are bananas high in fiber?" onClose={() => {}} />);
    expect(complete).toHaveBeenCalledTimes(1);

    await withdraw();
    await out.answer("About 3 g.");
    expect(files["coach-chat.json"]).toBeUndefined();
  });

  it("saves the conversation when nothing changed (positive control)", async () => {
    const { recordAiJournalConsent } = await import("../features/aiConsent");
    expect(await recordAiJournalConsent(false)).toBe(true);
    const out = pending();
    const { CoachChatModal } = await import("../components/CoachChatModal");
    await render(<CoachChatModal initialQuestion="are bananas high in fiber?" onClose={() => {}} />);
    await out.answer("About 3 g.");
    expect(JSON.parse(files["coach-chat.json"]!)).toHaveLength(2);
  });
});
