/**
 * The words on the consent-to-collect screen (components/HealthConsentGate).
 * Per-app: they must describe what THIS app collects and sends. A material
 * change here means bumping HEALTH_CONSENT_VERSION in healthConsent.ts.
 */

export const CONSENT_APP_NAME = "Conjure Fitness";

export const CONSENT_BODY: string[] = [
  "Conjure Fitness keeps a record of things about your body and your training: your plan and goals, the workouts you do and how they went, your benchmark results, your weight if you log it, and anything you tell the coach, including injuries or limits. Privacy laws such as Washington's My Health My Data Act call this consumer health data, and we ask for your agreement before we collect any.",
  "It is stored on your device and in your ConjureOS account. It is never sold, and never used for advertising.",
  "Some features send part of it to an AI to work. Building a plan sends your goal, experience, schedule, equipment and any injuries. Every message to the coach sends your plan, profile, recent weigh-ins, your last 8 workouts and what the coach remembers about you. Other ConjureOS apps can read your workouts only when you allow them.",
];

export const CONSENT_CHECKBOX =
  "I agree that ConjureOS LLC may collect and store my health data in Conjure Fitness, and use it for these features, including sending it to an AI as described, as the Consumer Health Data Privacy policy describes.";
