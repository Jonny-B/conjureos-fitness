/**
 * The coach conversation. It lives in the Coach tab and nowhere else:
 * `coach-chat.json` is its whole record, proposal cards included. Conjure
 * Fitness takes no place in the ConjureOS Chat panel (ConjureOS removed the
 * app chat hub, #513; an anchor app works as any outside app would).
 */

import type { ChatMessage } from "../../bridge/ai";
import { readJson, writeJson } from "../../bridge/vfs";
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

async function loadLocal(): Promise<CoachChatItem[]> {
  const raw = await readJson<CoachChatItem[]>(CHAT_PATH, []).catch(() => []);
  return Array.isArray(raw) ? raw : [];
}

/** Persist the conversation, trimmed to the most recent MAX_STORED items. */
export async function saveCoachHistory(items: CoachChatItem[]): Promise<void> {
  await writeJson(CHAT_PATH, items.slice(-MAX_STORED)).catch(() => {});
}

/** The conversation, oldest first. Never throws. */
export async function loadCoachHistory(): Promise<CoachChatItem[]> {
  return loadLocal();
}

/** Record one turn: the whole conversation, to the file. */
export async function recordCoachTurn(items: CoachChatItem[]): Promise<void> {
  await saveCoachHistory(items);
}
