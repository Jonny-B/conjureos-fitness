/**
 * "Reset data" (settings) — itemized, permanent history clears.
 *
 * Each item wipes ONE history: workout history (sessions + daily check-offs),
 * the coach conversation, the coach's memory, the current plan, or archived
 * plans. "Everything" runs the lot. Deliberately NOT touched: the profile and
 * settings/units — those aren't histories.
 *
 * Every clear is best-effort per store (a failure in one store never blocks
 * the others) and idempotent — clearing an already-empty history is a no-op.
 */

import { getRepository } from "../data/repository";
import { vfs } from "../bridge/vfs";

/** One independently clearable slice of the user's history. */
export type HistoryKind = "workouts" | "coach" | "coachChat" | "planHistory" | "plan";

/** The clearable history slices with their user-facing copy, in the order
 *  Settings lists them. Drives the reset UI so labels live beside the logic. */
export const HISTORY_ITEMS: { kind: HistoryKind; label: string; desc: string }[] = [
  { kind: "workouts", label: "Workout history", desc: "Completed sessions and daily check-offs" },
  { kind: "coachChat", label: "Coach conversation", desc: "Everything you've said to the coach, and its replies" },
  { kind: "coach", label: "Coach memory", desc: "What the coach remembers about you" },
  {
    kind: "plan",
    label: "Current plan",
    desc: "Your goal, dates, program and plan notes. Workout history is kept.",
  },
  { kind: "planHistory", label: "Past plans", desc: "Only the archive of previous plans" },
];

const rm = (path: string) => vfs.rm(path).catch(() => {});

/**
 * Permanently delete one slice of the user's history. DESTRUCTIVE and not
 * undoable — callers must confirm first.
 *
 * Never rejects: each underlying delete is best-effort, so one unavailable
 * store can't leave the rest of a "clear all" half-applied.
 */
export async function clearHistory(kind: HistoryKind): Promise<void> {
  const repo = await getRepository();
  switch (kind) {
    case "workouts":
      await repo.clearWorkoutHistory().catch(() => {});
      return;
    case "coachChat":
      await rm("coach-chat.json");
      return;
    case "coach":
      // The coach's long-term memory of the user, separate from the thread.
      await rm("coach.json");
      return;
    case "planHistory":
      await rm("plan-archive.json");
      return;
    case "plan":
      // The ACTIVE plan. "Past plans" only ever removed the archive, so a user
      // who cleared everything still landed on the Plan tab with their old plan.
      await repo.clearPlan().catch(() => {});
      return;
  }
}

/** Clear every history above. */
export async function clearAllHistories(): Promise<void> {
  for (const item of HISTORY_ITEMS) {
    await clearHistory(item.kind);
  }
}
