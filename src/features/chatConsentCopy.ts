/**
 * The words for ConjureOS Chat's own yes or no (features/chatConsent.ts): the
 * Chat sheet (components/ChatConsentSheet.tsx) and its row in Settings.
 *
 * They must say what Chat can actually read: the read actions in
 * bridge/fitnessActions.ts (listWorkouts, trainingSummary, nextWorkout), the
 * only ones Chat may call for a model. Change them together, and bump
 * CHAT_CONSENT_VERSION (with package.json's conjureos.aiAgreement) when what
 * Chat gets changes materially. No em-dashes, and never "now", "no longer" or
 * "yet": the person reading has not seen another version to compare with.
 */

/** The first line of the sheet when ConjureOS Chat asked for it. */
export const CHAT_ASKED = "ConjureOS Chat asked to use your Fitness data to answer you.";

export const CHAT_TITLE = "Use your Fitness data in ConjureOS Chat?";

export const CHAT_INTRO =
  "This covers ConjureOS Chat and the prompt on the ConjureOS home screen. Chat reads your Fitness data only to answer something you ask, and sends what it reads to the AI that writes its answer, as the Consumer Health Data Privacy policy describes. Nothing is read on a schedule.";

/** What Chat can read: one line per read action. */
export const CHAT_READS: string[] = [
  "Your workouts: the day, name and kind of each, how long it took, the calories it burned, and the distance of a run or ride. Up to 92 days at a time.",
  "A summary of a week's training: how many workouts and active days, your plan's days-per-week goal, and the minutes, calories and distance.",
  "Your next planned workout, with its exercises and sets, and how far you are through the current group of workouts.",
];

/** What Chat never gets from Conjure Fitness. */
export const CHAT_WITHHOLDS: string[] = [
  "Your routes and location",
  "Your weight, height, age and the rest of your profile",
  "What you tell the coach, and what it remembers about you",
  "Workouts synced from Apple Health, Health Connect or a wearable",
  "Your name, email and account details",
];

export const CHAT_CHOICE =
  "Your answer changes nothing else in Conjure Fitness. You can change it at any time in Settings, under Privacy. Withdrawing cannot pull back what Chat was already sent. Withdrawing your agreement to keep health data in Conjure Fitness withdraws this too.";

/** On the sheet when an Allow could not be saved: nothing was allowed. */
export const CHAT_AGREEMENT_NOT_SAVED = "Your answer was not saved, so Chat cannot use your Fitness data. Try again.";

/** In Settings when a withdrawal could not be saved. */
export const CHAT_WITHDRAW_NOT_SAVED =
  "Your withdrawal was not saved, so it holds only while the app stays open. Try again so it holds after you close it.";

/** The Settings row, while Chat may use the data. */
export function chatAllowedLine(acceptedAt: string): string {
  const day = new Date(acceptedAt);
  const on = Number.isNaN(day.getTime()) ? "" : ` You allowed it on ${day.toLocaleDateString()}.`;
  return `ConjureOS Chat can use your Fitness data to answer you: your workouts, your week's training and your next planned workout.${on}`;
}

/** The Settings row, while it may not. */
export const CHAT_NOT_ALLOWED =
  "ConjureOS Chat cannot use your Fitness data. Allow it, and Chat can read your workouts, your week's training and your next planned workout to answer you.";
