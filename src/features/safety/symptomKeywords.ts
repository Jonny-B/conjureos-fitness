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
 * acceptable; false negatives are not. Phrases are lowercase and match as plain
 * substrings of the lowercased input, so inflections still trip them ("I feel
 * nauseated" trips "nausea", "felt a popping" trips "felt a pop"). The only
 * exceptions are the few short stems that sit inside everyday words (see
 * WHOLE_WORD): "number of reps" must not trip "numb".
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
  "nauseous",
  "cold sweat",
  "clammy",
];

/** The fixed reply shown instead of any model call when a red-flag phrase hits. */
export const STOP_SYMPTOM_REPLY =
  "What you describe can be a warning sign, so please stop exercising now. " +
  "I can't assess symptoms like this. Please get medical help before you train again. " +
  "If it's severe or getting worse (chest pain, trouble breathing, fainting), call your local emergency number right away.";

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Stems that would fire on everyday words as substrings ("numb" in "number",
 *  "faint" in "faintly"). These match as whole words plus a common ending
 *  (-s, -ed, -ing, -ness); every other phrase is a plain substring. */
const WHOLE_WORD: ReadonlySet<string> = new Set(["numb", "faint"]);

const WHOLE_WORD_PATTERNS: ReadonlyMap<string, RegExp> = new Map(
  [...WHOLE_WORD].map((stem): [string, RegExp] => [stem, new RegExp(`\\b${escapeRe(stem)}(?:s|es|ed|ing|ness)?\\b`)]),
);

/**
 * Returns the first matched red-flag phrase in `text`, or null if none. The
 * matched phrase is returned (not just a boolean) so the caller can log which
 * trigger fired without re-scanning.
 */
export function detectStopSymptom(text: string): string | null {
  // Curly apostrophes (phone keyboards) must still match "can't breathe", and a
  // line break or double space between words must not hide "chest pain".
  const t = text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");
  for (const phrase of STOP_SYMPTOMS) {
    const re = WHOLE_WORD_PATTERNS.get(phrase);
    if (re ? re.test(t) : t.includes(phrase)) return phrase;
  }
  return null;
}

/** Convenience boolean wrapper around {@link detectStopSymptom}. */
export function isStopSymptom(text: string): boolean {
  return detectStopSymptom(text) !== null;
}
