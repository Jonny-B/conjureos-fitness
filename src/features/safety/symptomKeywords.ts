/**
 * Safety layer 3 — the pre-LLM symptom classifier.
 *
 * Before ANY coach model call, the user's "Tell coach" text is screened for
 * red-flag symptom language. A hit ends the workout session deterministically
 * (no model in the loop) and surfaces a stop-and-seek-help message. This is a
 * blunt keyword screen on purpose: it must fire even if the LLM would have
 * mishandled the input, and it must be auditable.
 *
 * The list errs toward caution — false positives (ending a session early) are
 * acceptable; false negatives are not. Phrases are lowercase; matching is on
 * whole words (plus common endings like -s, -ing, -ness) in the lowercased
 * input, so "I'm getting chest pain" trips "chest pain" but "number of reps"
 * does not trip "numb".
 */

/** Red-flag phrases that end a coach session before any model call. */
export const STOP_SYMPTOMS: readonly string[] = [
  "chest pain",
  "chest tightness",
  "chest pressure",
  "short of breath",
  "shortness of breath",
  "can't breathe",
  "cant breathe",
  "trouble breathing",
  "dizzy",
  "dizziness",
  "lightheaded",
  "light-headed",
  "faint",
  "fainted",
  "passed out",
  "black out",
  "blacked out",
  "palpitation",
  "heart racing",
  "irregular heartbeat",
  "numb",
  "numbness",
  "tingling",
  "blurred vision",
  "blurry vision",
  "slurred speech",
  "severe pain",
  "sharp pain",
  "stabbing pain",
  "heard a pop",
  "felt a pop",
  "popping sound",
  "can't move",
  "cant move",
  "throwing up",
  "vomit",
  "nausea",
  "cold sweat",
  "clammy",
];

/** The fixed reply shown instead of any model call when a red-flag phrase hits. */
export const STOP_SYMPTOM_REPLY =
  "What you describe can be a warning sign, so please stop exercising now. " +
  "I can't assess symptoms like this. Please get medical help before you train again. " +
  "If it's severe or getting worse (chest pain, trouble breathing, fainting), call your local emergency number right away.";

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One whole-word regex per phrase: a leading word boundary, then the phrase,
 *  then an optional common ending, then a trailing boundary. So "numb" matches
 *  "numb" / "numbness" but not "number", and "faint" matches "fainting" but
 *  not "faintly". */
const STOP_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = STOP_SYMPTOMS.map((phrase) => [
  phrase,
  new RegExp(`\\b${escapeRe(phrase).replace(/ /g, "\\s+")}(?:s|es|ed|ing|ness)?\\b`),
]);

/**
 * Returns the first matched red-flag phrase in `text`, or null if none. The
 * matched phrase is returned (not just a boolean) so the caller can log which
 * trigger fired without re-scanning.
 */
export function detectStopSymptom(text: string): string | null {
  // Curly apostrophes (phone keyboards) must still match "can't breathe".
  const t = text.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  for (const [phrase, re] of STOP_PATTERNS) {
    if (re.test(t)) return phrase;
  }
  return null;
}

/** Convenience boolean wrapper around {@link detectStopSymptom}. */
export function isStopSymptom(text: string): boolean {
  return detectStopSymptom(text) !== null;
}
