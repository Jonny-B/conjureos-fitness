/**
 * "Reset health data" (settings) — itemized, permanent history clears.
 *
 * Each item wipes ONE history: the food diary, weight history, workout history
 * (sessions + daily check-offs), coach conversation + memory, or archived
 * plans. "Everything" runs the lot. Deliberately NOT touched: the profile,
 * settings/units, and the ACTIVE plan — those aren't histories, and the cog
 * already has "Start a new plan" for replacing the plan itself.
 *
 * Every clear is best-effort per store (a failure in one store never blocks
 * the others) and idempotent — clearing an already-empty history is a no-op.
 */

import { getRepository } from "../data/repository";
import { vfs } from "../bridge/vfs";

export type HistoryKind = "diary" | "weights" | "workouts" | "coach" | "planHistory";

export const HISTORY_ITEMS: { kind: HistoryKind; label: string; desc: string }[] = [
  { kind: "diary", label: "Food diary", desc: "Every logged meal and snack" },
  { kind: "weights", label: "Weight history", desc: "All weigh-ins and the trend graph" },
  { kind: "workouts", label: "Workout history", desc: "Completed sessions and daily check-offs" },
  { kind: "coach", label: "Coach conversations", desc: "Chat history and the coach's memory of you" },
  { kind: "planHistory", label: "Past plans", desc: "Archived plans from previous resets" },
];

const rm = (path: string) => vfs.rm(path).catch(() => {});

export async function clearHistory(kind: HistoryKind): Promise<void> {
  const repo = await getRepository();
  switch (kind) {
    case "diary":
      await repo.clearDiary().catch(() => {});
      return;
    case "weights":
      await repo.clearWeights().catch(() => {});
      return;
    case "workouts":
      await repo.clearWorkoutHistory().catch(() => {});
      return;
    case "coach":
      // Conversation + long-term memory live as their own VFS docs.
      await rm("coach-chat.json");
      await rm("coach.json");
      return;
    case "planHistory":
      await rm("plan-archive.json");
      return;
  }
}

/** Clear every history above (plus the food-lookup cache, which is derived
 *  data and pointless to keep once the diary is gone). */
export async function clearAllHistories(): Promise<void> {
  for (const item of HISTORY_ITEMS) {
    await clearHistory(item.kind);
  }
  await rm("food-cache.json");
}
