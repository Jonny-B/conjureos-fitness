/**
 * The yes or no for ConjureOS Chat: whether Chat (and the ConjureOS home
 * prompt, its orchestrator) may use this person's Fitness data to answer them
 * (ConjureOS #1230).
 *
 * Separate from the agreement to keep health data (features/healthConsent.ts)
 * by PM decision, 2026-11-06, on the owner's behalf: that agreement is the
 * price of using the app at all, so folding Chat into it would cost anyone who
 * says no to Chat the whole app. Here a no to Chat changes nothing else.
 *
 * `conjureos.aiAgreement` in package.json names this file, and ConjureOS reads
 * it itself, every time, in these shapes:
 *
 *   missing                     not answered
 *   null                        withdrawn
 *   { refusedAt }               refused
 *   { acceptedAt, version: 1 }  agreed
 *   anything else               unknown, never agreed
 *
 * What the host hears (bridge/agreement.ts `reportAgreement`) follows this file
 * alone: a refusal or a withdrawal is told at once, before the write, and an
 * agreement only after it is saved, since the file is the only thing that can
 * make the app agreed. A withdrawal of the agreement to keep health data
 * withdraws this too (healthConsent.ts); agreeing to keep health data does not
 * agree to this.
 *
 * Because ConjureOS reads this file alone, it must never say agreed without
 * the agreement to keep health data on file. Allow checks that agreement again
 * once it is saved, and `withdrawStaleChatAgreement` clears one left behind
 * (by a withdrawal whose Chat write failed, a copy older than 0.7.0 that
 * clears only health-consent.json, or another device), wherever that
 * agreement is found not on file.
 *
 * A read for a model needs both agreements, each read from its file again
 * (bridge/actions.ts). Fitness's own AI features (features/aiGate.ts) answer
 * to the agreement to keep health data alone and never read this file.
 *
 * Stored as its own VFS file beside health-consent.json, so it follows the
 * person between devices through their ConjureOS account. Bump
 * CHAT_CONSENT_VERSION, and the manifest with it, when what Chat gets changes
 * materially: agreement to old wording is not agreement to new wording.
 */

import { reportAgreement } from "../bridge/agreement";
import { readJson, writeJsonOrThrow } from "../bridge/vfs";
import { healthAgreementOnFile } from "./healthConsent";

/** The file `conjureos.aiAgreement` in package.json names. */
export const CHAT_CONSENT_FILE = "chat-consent.json";
export const CHAT_CONSENT_VERSION = 1;

export type ChatAgreementState = "agreed" | "not_answered" | "refused" | "withdrawn" | "unknown";

/** What a read falls back to when there is no file, or none that parses. */
const NO_FILE: unique symbol = Symbol("no file");

/**
 * An answer given in this session: it stands over whatever the file says until
 * the person allows Chat here. The write that records it can fail or still be
 * in progress, and an agreement read back from before it must never let a
 * model read through (the same rule as healthConsent.ts).
 */
let held: "withdrawn" | "refused" | null = null;
/** Moves on every answer given here, so work begun under one keeps nothing under another. */
let generation = 0;
const listeners = new Set<() => void>();

function changed(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* one listener failing must not stop the others, or the answer */
    }
  }
}

/** Run `fn` after every answer given in this session. Returns the unsubscribe. */
export function onChatAgreementChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Which answer this session is on. See `stillChatAgreed`. */
export function chatConsentGeneration(): number {
  return generation;
}

/**
 * Whether work begun under generation `at` may still hand over what it got:
 * nobody withdrew or refused here since, and nothing else was answered here
 * meanwhile. Synchronous, so it runs right before the return it guards. It
 * says nothing about the file; read that with `chatAgreedOnFile`.
 */
export function stillChatAgreed(at: number): boolean {
  return held === null && at === generation;
}

/** What the file holds, read as ConjureOS reads it. Changes nothing. */
function classify(raw: unknown): ChatAgreementState {
  if (raw === NO_FILE) return "not_answered";
  if (raw === null) return "withdrawn";
  if (typeof raw !== "object" || Array.isArray(raw)) return "unknown";
  const o = raw as Record<string, unknown>;
  if (typeof o.refusedAt === "string") return "refused";
  if (typeof o.acceptedAt === "string" && o.version === CHAT_CONSENT_VERSION) return "agreed";
  return "unknown";
}

async function readFile(): Promise<{ state: ChatAgreementState; acceptedAt?: string }> {
  // readJson answers NO_FILE for a missing file and for one that does not
  // parse: either way nothing was agreed.
  const raw = await readJson<unknown>(CHAT_CONSENT_FILE, NO_FILE).catch(() => NO_FILE);
  const state = classify(raw);
  return state === "agreed" ? { state, acceptedAt: (raw as { acceptedAt: string }).acceptedAt } : { state };
}

/**
 * Where Chat stands, for Settings and the Chat sheet: the file, with an answer
 * given in this session over it.
 */
export async function chatAgreementState(): Promise<ChatAgreementState> {
  if (held) return held;
  const { state } = await readFile();
  // An answer can land while the file is read.
  return held ?? state;
}

/**
 * When Chat was allowed, as the file says right now, or undefined when it may
 * not use this app's data. Reads the file every time: a withdrawal on another
 * device reaches this session only as a change to it. An answer given here
 * stands over the file.
 */
export async function chatAgreedOnFile(): Promise<string | undefined> {
  if (held) return undefined;
  const { acceptedAt } = await readFile();
  return held ? undefined : acceptedAt;
}

/**
 * Allow. Saved before anything else: an agreement that lives only in memory
 * is not a record, so a failed write leaves Chat where it was and returns
 * false, and the host hears nothing. The caller makes sure the agreement to
 * keep health data is in place first: this one cannot stand without it. That
 * agreement can be withdrawn on another device while this saves, so it is
 * read again once this is saved, and without it this withdraws itself and
 * returns false before the host hears "agreed".
 */
export async function recordChatAgreement(): Promise<boolean> {
  const mine = ++generation;
  try {
    await writeJsonOrThrow(CHAT_CONSENT_FILE, { acceptedAt: new Date().toISOString(), version: CHAT_CONSENT_VERSION });
  } catch {
    return false;
  }
  // A withdrawal or refusal given while this saved is the later answer.
  if (mine !== generation) return false;
  if ((await healthAgreementOnFile()) === undefined) {
    if (mine === generation) await withdrawChatAgreement();
    return false;
  }
  if (mine !== generation) return false;
  held = null;
  generation++;
  // After the save: the report only makes the host read the file again.
  reportAgreement("agreed");
  changed();
  return true;
}

/**
 * Don't allow. The host is told first, so Chat leaves this app out whether or
 * not the file takes it, and the refusal holds for the session. Returns
 * whether it was saved; a refusal that was not saved reads as not answered
 * next time, which only means Chat asks again.
 */
export async function refuseChatAgreement(): Promise<boolean> {
  held = "refused";
  generation++;
  reportAgreement("refused");
  changed();
  try {
    await writeJsonOrThrow(CHAT_CONSENT_FILE, { refusedAt: new Date().toISOString() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Withdraw. Takes effect before anything is saved, and holds for the session
 * whatever the save does: the host is told before the file is written null,
 * the order healthConsent.ts uses. Returns whether it was saved; the next
 * session reads the file, so the caller says when it was not, and calling
 * this again is the retry. It cannot pull back what Chat was already sent.
 */
export async function withdrawChatAgreement(): Promise<boolean> {
  held = "withdrawn";
  generation++;
  reportAgreement("withdrawn");
  changed();
  try {
    await writeJsonOrThrow(CHAT_CONSENT_FILE, null);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear a Chat agreement left on file without the agreement to keep health
 * data, for callers that found that agreement not on file. ConjureOS reads
 * this file alone, so one left saying agreed would let it send what a
 * conversation already holds, and would agree Chat again, unasked, once the
 * agreement to keep health data is given again (#1230 review). It is
 * withdrawn the usual way: the host is told, then the file is written null.
 *
 * Returns false only when such an agreement is on file and could not be
 * cleared. An answer given here while the file is read is the later one, and
 * is left to stand.
 */
export async function withdrawStaleChatAgreement(): Promise<boolean> {
  const at = generation;
  const { state } = await readFile();
  if (state !== "agreed" || at !== generation) return true;
  return withdrawChatAgreement();
}
