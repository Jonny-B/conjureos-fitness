/**
 * The guided profile/goals setup model — shared by the setup wizard and the
 * Home banner so "which step is next" is computed one way. Completion is stored
 * on `Profile.setup.completedSteps` (additive, rides saveProfile).
 */

import type { Profile } from "../types";

export interface SetupStep {
  id: string;
  /** Short label for the banner ("Finish setting up — {label}"). */
  label: string;
  /** Wizard heading. */
  title: string;
}

export const SETUP_STEPS: readonly SetupStep[] = [
  { id: "basics", label: "your basics", title: "The basics" },
  { id: "body", label: "your body stats", title: "Your body" },
  { id: "activity", label: "activity & goal", title: "Activity & goal" },
  { id: "targets", label: "daily targets", title: "Your daily targets" },
] as const;

export function completedSet(profile: Profile | null): Set<string> {
  return new Set(profile?.setup?.completedSteps ?? []);
}

export function isSetupComplete(profile: Profile | null): boolean {
  if (!profile) return false;
  const done = completedSet(profile);
  return SETUP_STEPS.every((s) => done.has(s.id));
}

/** The first step the user hasn't finished, or null when setup is complete. */
export function firstIncompleteStep(profile: Profile | null): SetupStep | null {
  const done = completedSet(profile);
  return SETUP_STEPS.find((s) => !done.has(s.id)) ?? null;
}
