/**
 * Conjure Fitness sends to the AI only under the person's agreement to keep
 * their health data, which is also the agreement that names what goes to the
 * AI (features/healthConsentCopy.ts). Owner decisions 2026-10-22 ("Withdrawn
 * consent means they have withdrawn consent") and 2026-10-29 (ConjureOS
 * #1163: "If you remove consent, we should stop the plan builder and photo,
 * and you would have to re-agree").
 *
 *   - Every AI feature sends nothing without that agreement, or after it is
 *     withdrawn. Food questions also need their own AI agreement
 *     (features/aiConsent.ts).
 *   - An answer that lands after a withdrawal keeps nothing: no coach chat,
 *     no coach memory, no plan change (conjureos-fitness#96), and no plan
 *     saved by the workout engine either.
 *
 * Each test loads the modules afresh, because a withdrawal holds for the rest
 * of the session it happened in. Only the AI call, the files and the stored
 * profile, plan and sessions are stand-ins.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatImage } from "../bridge/ai";
import type { LiabilityAck, Plan, Profile, Workout, WorkoutSession } from "../types";
import { DEFAULT_GOALS } from "../types";
import type { PlanInput } from "./plan/model";
import { EMPTY_MEMORY, type CoachContext } from "./coach/model";

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

let profile: Profile | null;
const saved = { plans: [] as Plan[], profiles: [] as Profile[], sessions: [] as WorkoutSession[] };
vi.mock("../data/repository", () => ({
  getRepository: async () => ({
    getProfile: async () => profile,
    saveProfile: async (p: Profile) => {
      saved.profiles.push(p);
      profile = p;
    },
    savePlan: async (p: Plan) => void saved.plans.push(p),
    saveGoals: async () => {},
    getGoals: async () => DEFAULT_GOALS,
    listWorkoutSessions: async () => saved.sessions,
    saveWorkoutSession: async (s: WorkoutSession) => void saved.sessions.push(s),
    listDiary: async () => [],
    listWater: async () => [],
    listSleep: async () => [],
    listSymptoms: async () => [],
    listWeights: async () => [],
  }),
}));

type Collection = typeof import("./healthConsent");
let collection: Collection;

const PERSON: Profile = {
  sex: "female", age: 34, heightCm: 168, weightKg: 70, activityLevel: "moderate",
  direction: "maintain", units: "metric",
};

function makePlan(done = false): Plan {
  return {
    id: "p",
    mode: "get_fit",
    durationWeeks: 4,
    startDate: "2026-10-01",
    endDate: "2026-10-28",
    goals: [],
    safety: { ageBand: "18_39", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "active" },
    liability: { acknowledged: true, acceptedAt: "2026-10-01T00:00:00Z" },
    createdAt: "2026-10-01T00:00:00Z",
    targets: { dailyCalories: 2000, protein: 120, carbs: 220, fat: 70 },
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
          ...(done ? { completedAt: "2026-10-20T10:00:00Z" } : {}),
        },
      ],
      benchmarks: [
        { id: "b", exerciseKey: "squat", name: "Squat", metric: "reps", baseline: 8, target: 20, unit: "reps", history: [] },
      ],
      analysisCursor: 0,
    },
  } as Plan;
}

const ctx = (): CoachContext => ({
  plan: makePlan(),
  profile: { ...PERSON },
  goals: DEFAULT_GOALS,
  memory: EMPTY_MEMORY,
  rendered: "Program exercises (use these exact keys): squat.",
});

const ADJUST = '{ "summary": "Lighter squats", "changes": [ { "op": "setReps", "exerciseKey": "squat", "reps": 8 } ] }';
const REMEMBER = '<remember>{ "notes": ["Trains early"], "summary": "Early riser." }</remember>';
const CHECKIN = JSON.stringify({
  reply: "Nice work.",
  notes: ["Knee is cranky"],
  summary: "Steady week.",
  adjustment: JSON.parse(ADJUST),
});
const PHOTO: ChatImage = { mediaType: "image/jpeg", data: "AAAA" };
const PLAN_INPUT: PlanInput = {
  mode: "get_fit", goalText: "get stronger", durationWeeks: 4, daysPerWeek: 3, experienceLevel: "beginner",
  equipment: "none", heightCm: 168, weightKg: 70, age: 34, sex: "female",
  safety: { ageBand: "18_39", pregnant: false, cardiacFlag: false, injuries: [], activityLevel: "moderate" },
} as PlanInput;
const ACK: LiabilityAck = { acknowledged: true, acceptedAt: "2026-10-01T00:00:00Z" };
const SESSION: WorkoutSession = {
  id: "s1", date: "2026-10-20", planned: [], actual: [], reprompts: [],
  completedAt: "2026-10-20T10:30:00Z", durationSec: 1800,
} as WorkoutSession;
const WORKOUT: Workout = { id: "w", name: "Leg Day", exercises: [], origin: "built-in" } as Workout;

const memory = () => (files["coach.json"] ? JSON.parse(files["coach.json"]) : null);

/** The person agrees to keep health data, as the agreement screen records it. */
async function agree() {
  expect(await collection.recordHealthConsent()).toBe(true);
}

/** Withdraw while the request is out, then answer. */
function withdrawWhileOut(answer: string, agreeAgain = false) {
  complete.mockImplementation(async () => {
    await collection.withdrawHealthConsent();
    if (agreeAgain) await collection.recordHealthConsent();
    return answer;
  });
}

beforeEach(async () => {
  vi.resetModules();
  complete.mockReset();
  for (const k of Object.keys(files)) delete files[k];
  profile = { ...PERSON };
  saved.plans = [];
  saved.profiles = [];
  saved.sessions = [];
  collection = await import("./healthConsent");
});

/** Every AI feature in the app, as one call that would send. */
const FEATURES: { name: string; answer: string; run: () => Promise<unknown> }[] = [
  {
    name: "building a plan",
    answer: "{}",
    run: async () => (await import("./plan/generate")).createPlan(PLAN_INPUT, ACK),
  },
  {
    name: "the coach's chat",
    answer: "Sounds good.",
    run: async () => (await import("./coach/coach")).coachChat([{ role: "user", content: "hi" }], ctx()),
  },
  {
    name: "the coach's check-in",
    answer: CHECKIN,
    run: async () =>
      (await import("./coach/coach")).evaluateCheckin("day", [{ id: "q1", question: "How was it?", value: "Hard" }], ctx()),
  },
  {
    name: "the check-in's questions",
    answer: '["d_over","d_goals","d_mood"]',
    run: async () =>
      (await import("./coach/questions")).dayQuestions({ calories: 2600, goal: 2000, missedGoals: ["Walk"] }),
  },
  {
    name: "adapting the program",
    answer: ADJUST,
    run: async () => (await import("./plan/analyze")).analyzeAndAdapt(makePlan(), [SESSION, SESSION, SESSION]),
  },
  {
    name: "calibrating to a benchmark",
    answer: ADJUST,
    run: async () => (await import("./plan/analyze")).calibrateToBenchmark(makePlan(), [SESSION]),
  },
  {
    name: "writing the next group",
    answer: ADJUST,
    run: async () => (await import("./plan/groups")).advanceToNextGroup(makePlan(true), [SESSION]),
  },
  {
    name: "estimating a workout's burn",
    answer: '{"kcal": 250}',
    run: async () => (await import("./calories")).estimateWorkoutBurn(SESSION, WORKOUT, null),
  },
  {
    name: "explaining an exercise",
    answer: '{"summary": "Sit back.", "steps": ["Stand tall"], "cues": ["Brace"]}',
    run: async () => (await import("./explainers/resolve")).resolveExplainer("squat", "Squat"),
  },
  {
    name: "food from a description",
    answer: '{"items": []}',
    run: async () => (await import("./naturalLanguage")).parseMealWithGroup({ text: "a banana" }),
  },
  {
    name: "a nutrition label photo",
    answer: '{"confidence": 0}',
    run: async () => (await import("./foods/labelParse")).parseNutritionLabel(PHOTO),
  },
  {
    name: "a package front photo",
    answer: '{"confidence": 0}',
    run: async () => (await import("./foods/frontParse")).estimateFromFront(PHOTO),
  },
];

const settle = (p: Promise<unknown>) => p.then(() => undefined, () => undefined);

describe.each(FEATURES)("$name", ({ answer, run }) => {
  beforeEach(() => complete.mockImplementation(async () => answer));

  it("sends nothing before the person agrees to keep health data", async () => {
    await settle(run());
    expect(complete).not.toHaveBeenCalled();
  });

  it("sends nothing after that agreement is withdrawn", async () => {
    await agree();
    await collection.withdrawHealthConsent();
    await settle(run());
    expect(complete).not.toHaveBeenCalled();
  });

  it("sends once agreed (positive control)", async () => {
    await agree();
    await settle(run());
    expect(complete).toHaveBeenCalled();
  });
});

describe("food questions also need their own AI agreement", () => {
  it("send nothing, not even the question, without it", async () => {
    await agree();
    complete.mockImplementation(async () => "Bananas have fiber.");
    const { askCoach } = await import("./coach/ask");
    await settle(askCoach("are bananas high in fiber?"));
    expect(complete).not.toHaveBeenCalled();
  });

  it("send once both agreements are on file (positive control)", async () => {
    await agree();
    const { recordAiJournalConsent } = await import("./aiConsent");
    expect(await recordAiJournalConsent(false)).toBe(true);
    complete.mockImplementation(async () => "Bananas have fiber.");
    const { askCoach } = await import("./coach/ask");
    expect(await askCoach("are bananas high in fiber?")).toBe("Bananas have fiber.");
  });
});

describe("an answer that lands after consent to keep health data is withdrawn keeps nothing (conjureos-fitness#96)", () => {
  it("the coach's chat writes no memory", async () => {
    await agree();
    withdrawWhileOut(`Noted. ${REMEMBER}`);
    const { coachChat } = await import("./coach/coach");
    await settle(coachChat([{ role: "user", content: "I train early" }], ctx()));
    expect(memory()).toBeNull();
  });

  it("the coach's chat applies no program change", async () => {
    await agree();
    withdrawWhileOut(`Done. <adjust>${ADJUST}</adjust>`);
    const { coachChat } = await import("./coach/coach");
    await settle(coachChat([{ role: "user", content: "Lighter squats" }], ctx(), { answering: true }));
    expect(saved.plans).toEqual([]);
    expect(memory()).toBeNull();
  });

  it("the coach's chat applies no plan-level change", async () => {
    await agree();
    withdrawWhileOut('Done. <planchange>{ "summary": "Later end", "endDate": "2026-11-30" }</planchange>');
    const { coachChat } = await import("./coach/coach");
    await settle(coachChat([{ role: "user", content: "Push the end date" }], ctx(), { answering: true }));
    expect(saved.plans).toEqual([]);
    expect(saved.profiles).toEqual([]);
  });

  it("the check-in writes no memory and changes no plan", async () => {
    await agree();
    withdrawWhileOut(CHECKIN);
    const { evaluateCheckin } = await import("./coach/coach");
    await settle(evaluateCheckin("day", [{ id: "q1", question: "How was it?", value: "Hard" }], ctx()));
    expect(memory()).toBeNull();
    expect(saved.plans).toEqual([]);
  });

  it("the check-in writes nothing when the call fails after the withdrawal, either", async () => {
    await agree();
    complete.mockImplementation(async () => {
      await collection.withdrawHealthConsent();
      throw new Error("network");
    });
    const { evaluateCheckin } = await import("./coach/coach");
    await settle(evaluateCheckin("day", [{ id: "q1", question: "How was it?", value: "Hard" }], ctx()));
    expect(memory()).toBeNull();
  });

  it("nothing is kept after a withdrawal and a new agreement, either", async () => {
    await agree();
    withdrawWhileOut(`Noted. ${REMEMBER}`, true);
    const { coachChat } = await import("./coach/coach");
    await settle(coachChat([{ role: "user", content: "I train early" }], ctx()));
    expect(memory()).toBeNull();
  });

  it("the coach applies a program change when nothing changed (positive control)", async () => {
    await agree();
    complete.mockImplementation(async () => `Done. <adjust>${ADJUST}</adjust>`);
    const { coachChat } = await import("./coach/coach");
    const out = await coachChat([{ role: "user", content: "Lighter squats" }], ctx(), { answering: true });
    expect(out.planUpdate).toBeTruthy();
    expect(saved.plans).toHaveLength(1);
  });

  it("the coach keeps what it learns when nothing changed (positive control)", async () => {
    await agree();
    complete.mockImplementation(async () => `Noted. ${REMEMBER}`);
    const { coachChat } = await import("./coach/coach");
    await coachChat([{ role: "user", content: "I train early" }], ctx());
    expect(memory()?.notes?.map((n: { text?: string } | string) => (typeof n === "string" ? n : n.text))).toContain(
      "Trains early",
    );
  });
});

describe("the workout engine saves no plan from an answer that lands after a withdrawal", () => {
  it("not after a finished workout", async () => {
    await agree();
    withdrawWhileOut(ADJUST);
    saved.sessions = [SESSION, SESSION];
    const { recordSessionAndAdapt } = await import("./plan/planService");
    await settle(recordSessionAndAdapt(makePlan(), { ...SESSION, id: "s3" }, { programWorkoutId: "pw" }));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(saved.plans).toEqual([]);
  });

  it("not when it starts the next group", async () => {
    await agree();
    withdrawWhileOut(ADJUST);
    const { startNextGroup } = await import("./plan/planService");
    await settle(startNextGroup(makePlan(true)));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(saved.plans).toEqual([]);
  });

  it("saves the plan when nothing changed (positive control)", async () => {
    await agree();
    complete.mockImplementation(async () => ADJUST);
    const { startNextGroup } = await import("./plan/planService");
    await startNextGroup(makePlan(true));
    expect(saved.plans).toHaveLength(1);
  });
});

/**
 * The rules above hold because every request goes through features/aiGate.ts.
 * A module that called the bridge itself would route around them.
 */
describe("the gate is the one way to the AI", () => {
  /** Shipped source, tests excluded, by path under src/. */
  const SHIPPED = Object.fromEntries(
    Object.entries(
      import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>,
    ).map(([path, text]) => [path.replace(/^\.\.\//, "").replace(/^\.\//, "features/"), text]),
  );

  it("no module but the gate imports complete() from the bridge", () => {
    const importers = Object.entries(SHIPPED)
      .filter(([, text]) => /import\s*\{[^}]*\bcomplete\b[^}]*\}\s*from\s*["'][./]+bridge\/ai["']/.test(text))
      .map(([path]) => path);
    expect(importers).toEqual(["features/aiGate.ts"]);
  });

  it("no module but the bridge reaches the host's AI", () => {
    const reach = Object.entries(SHIPPED)
      .filter(([, text]) => /__conjureos\??\.ai\b/.test(text))
      .map(([path]) => path);
    expect(reach).toEqual(["bridge/ai.ts"]);
  });

  it("every module that sends through the gate is one of the features above", () => {
    const senders = Object.entries(SHIPPED)
      .filter(([path, text]) => path !== "features/aiGate.ts" && /\bcompleteUnderAgreement\(/.test(text))
      .map(([path]) => path)
      .sort();
    expect(senders).toEqual([
      "features/calories.ts",
      "features/coach/ask.ts",
      "features/coach/coach.ts",
      "features/coach/questions.ts",
      "features/explainers/resolve.ts",
      "features/foods/frontParse.ts",
      "features/foods/labelParse.ts",
      "features/naturalLanguage.ts",
      "features/plan/analyze.ts",
      "features/plan/generate.ts",
      "features/plan/groups.ts",
    ]);
  });
});
