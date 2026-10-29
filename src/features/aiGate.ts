/**
 * THE GATE: the one place Conjure Fitness sends a request to the AI.
 *
 * Every AI feature here (building a plan, the coach's chat and check-ins, the
 * check-in questions, adapting and progressing the program, a workout's burn
 * estimate, exercise explainers, and the food features that are off with
 * NUTRITION_ENABLED) sends what the agreement to keep health data names
 * (features/healthConsentCopy.ts). So nothing goes without that agreement,
 * and an answer that lands after it is withdrawn is thrown away (owner
 * decisions 2026-10-22 and 2026-10-29, ConjureOS #1163):
 *
 *   - No agreement in force, or a withdrawal since the work started: nothing
 *     is sent. The agreement file is read around every request, so this holds
 *     for a withdrawal on another device too.
 *   - An answer, or a failure, that lands after a withdrawal, or after a
 *     withdrawal and a new agreement: the caller gets `AiNotAgreedError`
 *     instead, and keeps nothing.
 *
 * Callers that write after the answer also check `stillCollecting` right
 * before each write (features/healthConsent.ts). Calling `complete()` from
 * bridge/ai.ts anywhere else routes around all of this, so nothing else does
 * (features/aiAgreement.test.ts holds every module to it).
 */

import { complete, type CompleteRequest } from "../bridge/ai";
import { healthAgreementOnFile, healthConsentGeneration } from "./healthConsent";

/**
 * Why nothing was sent, or nothing kept: no agreement in force (`none`), or
 * it was withdrawn since the work started (`withdrawn`).
 */
export class AiNotAgreedError extends Error {
  readonly why: "none" | "withdrawn";
  constructor(why: "none" | "withdrawn") {
    super(why === "none" ? "No agreement to keep health data is in force." : "The agreement to keep health data was withdrawn.");
    this.name = "AiNotAgreedError";
    this.why = why;
  }
}

/** Whether `err` is the gate saying no. */
export function isAiNotAgreed(err: unknown): err is AiNotAgreedError {
  return err instanceof AiNotAgreedError || (err instanceof Error && err.name === "AiNotAgreedError");
}

/**
 * The agreement in force, as its date on file, when nothing was decided in
 * this session since `collecting`; undefined otherwise. Read from the file
 * each time, since another device can withdraw, or withdraw and agree again,
 * and this session only sees the file change (Health's gate does the same).
 */
async function agreedSince(collecting: number): Promise<string | undefined> {
  if (collecting !== healthConsentGeneration()) return undefined;
  const acceptedAt = await healthAgreementOnFile();
  return collecting === healthConsentGeneration() ? acceptedAt : undefined;
}

/**
 * Send one request under the agreement to keep health data and return the
 * model's text. `collecting` is `healthConsentGeneration()` read when the
 * work started, before anything was read for it; it defaults to now.
 *
 * The agreement on file right before the request is the one it is sent
 * under: an answer, or a failure, that lands when the file no longer holds
 * that same agreement (withdrawn, or withdrawn and given again, on any
 * device) is thrown away.
 *
 * Throws `AiNotAgreedError` when nothing was sent or the answer was thrown
 * away. Any other failure rejects as `complete()` does.
 */
export async function completeUnderAgreement(
  req: CompleteRequest,
  collecting: number = healthConsentGeneration(),
): Promise<string> {
  const under = await agreedSince(collecting);
  if (under === undefined) {
    throw new AiNotAgreedError(collecting === healthConsentGeneration() ? "none" : "withdrawn");
  }
  // Nothing is awaited between the check above and the request.
  let raw: string;
  try {
    raw = await complete(req);
  } catch (err) {
    if ((await agreedSince(collecting)) !== under) throw new AiNotAgreedError("withdrawn");
    throw err;
  }
  if ((await agreedSince(collecting)) !== under) throw new AiNotAgreedError("withdrawn");
  return raw;
}
