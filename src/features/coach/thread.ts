/**
 * The coach conversation, shared between the Coach tab and the ConjureOS app
 * chat hub (ConjureChat's panel, ConjureOS #513).
 *
 * `coach-chat.json` stays the app's full record (it keeps proposal cards, which
 * the hub cannot carry). With the hub, every in-app turn is also posted to the
 * single `main` thread, and a message typed in ConjureChat is answered here by
 * the same `coachChat` the Coach tab uses. Without the hub (older shells, the
 * chat permission refused) the Coach tab works from its own file alone.
 */

import type { ChatMessage } from "../../bridge/ai";
import { readJson, writeJson } from "../../bridge/vfs";
import { hubHistory, isChatHubAvailable, listenToHub, postToHub, type HubInbound } from "../../bridge/chatHub";
import type { Plan } from "../../types";
import { coachChat } from "./coach";
import { buildCoachContext } from "./context";
import type { CoachChatItem, CoachProposal } from "./model";

export const CHAT_PATH = "coach-chat.json";
export const MAX_STORED = 40;
/** Initial proposal plus one follow-up, as in the Coach tab. */
export const MAX_PROPOSAL_ROUNDS = 2;

/** The AI sees plain role/content; a proposal carries its question and options along. */
export function toChatMessages(items: CoachChatItem[]): ChatMessage[] {
  return items.map((m) => ({ role: m.role, content: m.proposal ? withProposal(m.content, m.proposal) : m.content }));
}

function withProposal(content: string, p: CoachProposal): string {
  return `${content ? `${content}\n\n` : ""}${p.question}\nOptions: ${p.options.map((o) => o.label).join(" / ")}`;
}

/** Whether the last item is a proposal still waiting for an answer. */
export function hasPendingProposal(items: CoachChatItem[]): boolean {
  const last = items[items.length - 1];
  return Boolean(last?.proposal && !last.answered);
}

/** Lock the trailing proposal once it has been answered. */
export function markAnswered(items: CoachChatItem[]): CoachChatItem[] {
  return items.map((m, i) => (i === items.length - 1 && m.proposal && !m.answered ? { ...m, answered: true } : m));
}

/** Consecutive trailing proposals, which caps the coach's follow-ups. */
function proposalRounds(items: CoachChatItem[]): number {
  let n = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i]!;
    if (m.role === "user") continue;
    if (!m.proposal) break;
    n++;
  }
  return n;
}

async function loadLocal(): Promise<CoachChatItem[]> {
  const raw = await readJson<CoachChatItem[]>(CHAT_PATH, []).catch(() => []);
  return Array.isArray(raw) ? raw : [];
}

/** Persist the conversation, trimmed to the most recent MAX_STORED items. */
export async function saveCoachHistory(items: CoachChatItem[]): Promise<void> {
  await writeJson(CHAT_PATH, items.slice(-MAX_STORED)).catch(() => {});
}

let seeding: Promise<void> | null = null;

/**
 * The conversation, oldest first. Never throws.
 *
 * The app's file is the history. When the hub thread is empty and the file is
 * not, the file is copied into the hub once. When the hub holds more than the
 * file (the conversation carried on elsewhere), the hub's thread is used.
 */
export async function loadCoachHistory(): Promise<CoachChatItem[]> {
  const local = await loadLocal();
  if (!isChatHubAvailable()) return local;
  const shared = await hubHistory();
  if (shared === null) return local;
  if (shared.length === 0 && local.length > 0) {
    if (!seeding) {
      seeding = (async () => {
        for (const m of local) {
          await postToHub(m.role, m.proposal ? withProposal(m.content, m.proposal) : m.content);
        }
      })();
    }
    await seeding;
    return local;
  }
  return shared.length > local.length ? shared : local;
}

/**
 * Record one in-app turn: the whole conversation to the file, and the new
 * question and reply to the hub when there is one.
 */
export async function recordCoachTurn(items: CoachChatItem[], question: string, reply: CoachChatItem): Promise<void> {
  await saveCoachHistory(items);
  if (isChatHubAvailable()) {
    await postToHub("user", question);
    await postToHub("assistant", reply.proposal ? withProposal(reply.content, reply.proposal) : reply.content);
  }
}

export interface ThreadChange {
  items: CoachChatItem[];
  /** Set when the coach applied a plan change from a ConjureChat message. */
  plan?: Plan;
}
type Listener = (change: ThreadChange) => void;
const listeners = new Set<Listener>();

/** Hear about turns answered from ConjureChat. Returns an unsubscribe. */
export function onCoachThreadChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Answer a message typed in ConjureChat with the coach's own logic. A pending
 * proposal makes the message its answer, exactly as typing it in the Coach tab
 * would. The hub records the message and this reply itself, so neither is
 * posted again; the file gets both.
 */
export async function answerHubMessage(m: HubInbound): Promise<string> {
  const local = await loadLocal();
  const base = local.length ? local : ((await hubHistory(m.messageId)) ?? []);
  const answering = hasPendingProposal(base);
  const grounded = answering ? markAnswered(base) : base;
  const withUser: CoachChatItem[] = [...grounded, { role: "user", content: m.content }];
  const ctx = await buildCoachContext();
  const outcome = await coachChat(toChatMessages(withUser), ctx, {
    answering,
    canPropose: (answering ? proposalRounds(base) : 0) < MAX_PROPOSAL_ROUNDS,
  });
  const assistant: CoachChatItem = {
    role: "assistant",
    content: outcome.reply,
    ...(outcome.proposal ? { proposal: outcome.proposal } : {}),
  };
  const items = [...withUser, assistant];
  await saveCoachHistory(items);
  const change: ThreadChange = outcome.planUpdate ? { items, plan: outcome.planUpdate.plan } : { items };
  for (const fn of listeners) fn(change);
  return outcome.proposal ? withProposal(outcome.reply, outcome.proposal) : outcome.reply;
}

let listening: Promise<boolean> | null = null;

/** Register with the chat hub at startup. Resolves false where there is no hub. */
export function startCoachChatHub(): Promise<boolean> {
  if (!listening) listening = listenToHub(answerHubMessage);
  return listening;
}

/** Test seam. */
export function resetCoachThread(): void {
  listening = null;
  seeding = null;
  listeners.clear();
}
