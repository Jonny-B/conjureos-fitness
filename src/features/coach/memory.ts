/**
 * Coach memory persistence — one VFS doc, load-merge-save. All writes are
 * best-effort (readJson/writeJson never throw); the in-memory result is
 * returned so callers can keep going even if persistence failed.
 */

import type { Plan } from "../../types";
import { readJson, writeJson } from "../../bridge/vfs";
import { EMPTY_MEMORY, type CoachEvent, type CoachMemory, type CoachMetric } from "./model";

const MEMORY_PATH = "coach.json";

// Caps keep coach.json small enough to inline into every prompt's context.
const MAX_NOTES = 40;
const MAX_EVENTS = 100;
const MAX_METRICS = 200;

export async function loadMemory(): Promise<CoachMemory> {
  const m = await readJson<CoachMemory>(MEMORY_PATH, EMPTY_MEMORY);
  if (!m || m.v !== 1 || !Array.isArray(m.notes)) return structuredClone(EMPTY_MEMORY);
  return m;
}

export interface MemoryPatch {
  /** New durable notes — deduped against existing, appended, capped. */
  notes?: string[];
  /** Replaces the running summary when non-empty. */
  summary?: string;
  /** Prepended (newest first). */
  events?: CoachEvent[];
  metrics?: CoachMetric[];
}

/** Load → merge the patch → save → return the merged memory. */
export async function remember(patch: MemoryPatch): Promise<CoachMemory> {
  const m = await loadMemory();
  const seen = new Set(m.notes.map((n) => n.toLowerCase()));
  for (const raw of patch.notes ?? []) {
    const note = raw.trim().slice(0, 160);
    if (note && !seen.has(note.toLowerCase())) {
      m.notes.push(note);
      seen.add(note.toLowerCase());
    }
  }
  m.notes = m.notes.slice(-MAX_NOTES);
  if (patch.summary?.trim()) m.summary = patch.summary.trim().slice(0, 600);
  if (patch.events?.length) m.events = [...patch.events, ...m.events].slice(0, MAX_EVENTS);
  if (patch.metrics?.length) m.metrics = [...patch.metrics, ...m.metrics].slice(0, MAX_METRICS);
  await writeJson(MEMORY_PATH, m);
  return m;
}

const planLine = (p: Plan): string =>
  `${p.mode} plan ${p.startDate}→${p.endDate}: ${p.goals.slice(0, 3).map((g) => g.label).join("; ")}`;

/**
 * Continuity across a "Start a new plan" reset: record the episode boundary so
 * the coach references the archived plan instead of being confused by the swap.
 * Diary/weight/workout history is continuous; only the plan changed.
 */
export async function recordPlanStarted(created: Plan, previous: Plan | null): Promise<void> {
  const text = previous
    ? `Started a new plan (${planLine(created)}). Previous ${planLine(previous)} was archived; food/weight/workout history continues unbroken.`
    : `Started their first plan (${planLine(created)}).`;
  await remember({ events: [{ at: new Date().toISOString(), kind: "plan_started", text }] });
}
