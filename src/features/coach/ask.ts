/**
 * "Ask about food" — the small, always-available nutrition Q&A on the home
 * screen.
 *
 * Deliberately NOT the trainer in coach.ts. That one proposes and applies plan
 * changes, adjusts programs and writes long-term memory, and it is paused with
 * the rest of the workout features (see features/flags). This is the narrow
 * thing that stayed useful without it: a question about food gets an answer,
 * and nothing about the user's plan moves.
 *
 * History shares `coach-chat.json` with the full coach screen, so a
 * conversation started here is still there when the trainer comes back.
 */

import { complete, isAiAvailable, type ChatMessage } from "../../bridge/ai";
import { readJson, writeJson } from "../../bridge/vfs";
import { getRepository } from "../../data/repository";
import { fmtWeight } from "../units";
import type { CoachChatItem } from "./model";

const CHAT_PATH = "coach-chat.json";

/** Turns kept on disk. Old turns fall off the top; the cap keeps the doc small
 *  enough to stay cheap to read on every home render. */
const MAX_STORED = 40;

/** Turns sent as context on a new question. Enough for follow-ups ("what about
 *  the green ones?") without paying for the whole history every time. */
const MAX_CONTEXT_TURNS = 10;

/**
 * The rotating prompts under the ask box. They exist to teach the shape of a
 * good question, so they lean concrete and everyday rather than clever — the
 * point is "oh, I can just ask it things", not a feature tour.
 */
export const ASK_SUGGESTIONS: readonly string[] = [
  "Are bananas high in fiber?",
  "Is oat milk better than dairy?",
  "How much protein is in two eggs?",
  "What's a filling snack under 200 calories?",
  "Is air-popped popcorn a good late-night snack?",
  "Does cooking spinach change its iron?",
  "What should I eat after a long walk?",
  "Is Greek yogurt worth it over regular?",
];

const SYSTEM = `You answer everyday food and nutrition questions inside a calorie-tracking app.

STYLE
- Answer the question first, in one or two sentences. Then at most two more sentences of useful detail.
- Plain language. No headers, no bullet lists, no markdown. This renders as a chat bubble.
- Real numbers when they help ("about 3 g of fiber in a medium banana"), and say when a number is approximate.
- Never open with a greeting or a restatement of the question.

SCOPE
- Food, nutrition, hydration, and general healthy-eating habits.
- If the user's own targets are relevant to the answer, use them. Do not recite them back otherwise.
- A question that is odd, vague or a joke still gets a straight, good-humoured answer. Do not lecture.

LIMITS
- You give general information, not medical or clinical advice. If the question is about a diagnosed
  condition, a medication interaction, a supplement regimen, disordered eating, or a child's diet, answer
  what is general and safely known, then say plainly that it is worth checking with a doctor or dietitian.
- Never suggest a calorie target below what the app already set, and never encourage restriction,
  purging, fasting as weight control, or "earning" food with exercise.
- You cannot change the user's plan, targets or diary. If asked, say that is done in the Plan tab.`;

/** One line of who's asking, so answers can be specific without the user
 *  repeating themselves. Silently degrades to nothing when the store is empty. */
async function askContext(): Promise<string> {
  try {
    const repo = await getRepository();
    const [goals, profile] = await Promise.all([repo.getGoals(), repo.getProfile()]);
    const bits: string[] = [];
    if (goals?.calories) {
      bits.push(
        `Daily targets: ${goals.calories} cal, ${goals.protein} g protein, ${goals.carbs} g carbs, ${goals.fat} g fat.`,
      );
    }
    if (profile?.weightKg && profile.units) {
      bits.push(`Current weight: ${fmtWeight(profile.weightKg, profile.units)}.`);
    }
    if (profile?.direction) {
      const dir =
        profile.direction === "lose" ? "losing weight" : profile.direction === "gain" ? "gaining weight" : "maintaining";
      bits.push(`Goal: ${dir}.`);
    }
    return bits.join(" ");
  } catch {
    return "";
  }
}

/** Read the stored conversation, oldest first. Never throws. */
export async function loadAskHistory(): Promise<CoachChatItem[]> {
  const raw = await readJson<CoachChatItem[]>(CHAT_PATH, []).catch(() => []);
  return Array.isArray(raw) ? raw : [];
}

/** Persist the conversation, trimmed to the most recent MAX_STORED turns. */
export async function saveAskHistory(items: CoachChatItem[]): Promise<void> {
  await writeJson(CHAT_PATH, items.slice(-MAX_STORED)).catch(() => {});
}

/**
 * Answer one question, given the conversation so far (oldest first, WITHOUT
 * the new question).
 *
 * Returns the reply text. Never throws and never mutates anything but the
 * chat doc — a failed call comes back as a sentence the user can read.
 */
export async function askCoach(question: string, history: CoachChatItem[] = []): Promise<string> {
  const q = question.trim();
  if (!q) return "";
  if (!isAiAvailable()) {
    return "I need the ConjureOS AI service to answer, and it isn't available right now. Open Conjure Health inside ConjureOS and try again.";
  }

  const ctx = await askContext();
  const messages: ChatMessage[] = [
    ...history
      .slice(-MAX_CONTEXT_TURNS)
      .map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: "user", content: q },
  ];

  try {
    const reply = await complete({
      system: ctx ? `${SYSTEM}\n\nABOUT THIS USER\n${ctx}` : SYSTEM,
      messages,
      maxTokens: 400,
      tier: "capable",
    });
    const text = reply.trim();
    return text || "I couldn't come up with an answer to that one. Try asking it a different way?";
  } catch {
    return "Something went wrong reaching the AI service. Try again in a moment.";
  }
}
