/**
 * Coach memory persistence: one VFS doc, load-merge-save. The VFS is the same
 * on every backend. A failed write is reported through reportSaveFailure
 * (logged, and the user is told), never thrown, so callers keep going with the
 * returned in-memory result.
 */

import type { Plan } from "../../types";
import { readJsonStrict, writeJsonOrThrow } from "../../bridge/vfs";
import { reportSaveFailure } from "../../data/saveFailure";
import { EMPTY_MEMORY, type CoachEvent, type CoachMemory, type CoachMetric } from "./model";

const MEMORY_PATH = "coach.json";

// Caps keep coach.json small enough to inline into every prompt's context.
const MAX_NOTES = 40;
const MAX_EVENTS = 100;
const MAX_METRICS = 200;

/** Strict read: throws when coach.json exists but cannot be read, so a
 *  read-modify-write never replaces it with a blank memory. Always returns a
 *  fresh object, never the shared EMPTY_MEMORY (remember() mutates it). */
async function readMemory(): Promise<CoachMemory> {
  const m = await readJsonStrict<CoachMemory | null>(MEMORY_PATH, null);
  if (!m || m.v !== 1 || !Array.isArray(m.notes)) return structuredClone(EMPTY_MEMORY);
  if (!Array.isArray(m.events)) m.events = [];
  if (!Array.isArray(m.metrics)) m.metrics = [];
  return m;
}

/**
 * Read the coach's durable memory of the user. Returns a fresh empty memory
 * — never null and never throws — when the file is missing, unreadable,
 * corrupt, or written by an older schema version.
 */
export async function loadMemory(): Promise<CoachMemory> {
  try {
    return await readMemory();
  } catch {
    return structuredClone(EMPTY_MEMORY);
  }
}

/** An incremental update to coach memory. Every field is merge-only: nothing
 *  here deletes, and each list is capped after merging. */
export interface MemoryPatch {
  /** New durable notes — deduped against existing, appended, capped. */
  notes?: string[];
  /** Replaces the running summary when non-empty. */
  summary?: string;
  /** Prepended (newest first). */
  events?: CoachEvent[];
  metrics?: CoachMetric[];
}

/** Load → merge the patch → save → return the merged memory. When coach.json
 *  exists but cannot be read, nothing is written (that would replace the
 *  remembered notes with just this patch): the failure is reported and the
 *  patch is merged into a blank memory for the caller only. */
export async function remember(patch: MemoryPatch): Promise<CoachMemory> {
  let m: CoachMemory;
  let readable = true;
  try {
    m = await readMemory();
  } catch (err) {
    readable = false;
    reportSaveFailure("what your coach remembers", err);
    m = structuredClone(EMPTY_MEMORY);
  }
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
  if (!readable) return m;
  try {
    await writeJsonOrThrow(MEMORY_PATH, m);
  } catch (err) {
    reportSaveFailure("what your coach remembers", err);
  }
  return m;
}

/**
 * A compact preferences/feedback block for the PROGRAM engine (next-group
 * progression + periodic adaptation + calibration). Surfaces what the user has
 * TOLD the coach — durable notes, the running summary, recent post-workout
 * reflections, and recent 1–5 metrics — so future workouts honor "I hate
 * burpees" / "knee is cranky" / "these felt brutal", not just the raw set data.
 * Empty string when there's nothing worth passing.
 */
export function summarizeMemoryForProgram(m: CoachMemory): string {
  const lines: string[] = [];
  if (m.summary) lines.push(`Summary: ${m.summary}`);
  if (m.notes.length)
    lines.push(`Preferences/constraints:\n${m.notes.slice(-12).map((n) => `  - ${n}`).join("\n")}`);
  const reflects = m.events.filter((e) => e.kind === "workout_reflect").slice(0, 5);
  if (reflects.length)
    lines.push(`Recent workout feedback:\n${reflects.map((e) => `  ${e.at.slice(0, 10)}: ${e.text}`).join("\n")}`);
  const met = m.metrics.slice(0, 8);
  if (met.length)
    lines.push(`Recent 1-5 check-in metrics:\n${met.map((v) => `  ${v.date} ${v.key}=${v.value}`).join("\n")}`);
  return lines.join("\n");
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
