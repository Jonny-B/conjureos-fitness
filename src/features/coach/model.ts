/**
 * Coach domain model (Phase 2). The coach is the app-wide AI trainer: it asks
 * short check-in questions after workouts and at the end of the day, keeps a
 * durable memory of what it learns, chats free-form, and can apply small,
 * validated adjustments to the active plan. Everything persists to the VFS
 * (coach.json / coach-chat.json) — no new backend surface.
 */

import type { Goals, Plan, Profile } from "../../types";

// ── Memory ───────────────────────────────────────────────────────────

export type CoachEventKind =
  | "workout_reflect"
  | "day_checkin"
  | "plan_started"
  | "plan_adjusted"
  | "note";

/** One timeline entry — something the coach should remember happened. */
export interface CoachEvent {
  /** ISO timestamp. */
  at: string;
  kind: CoachEventKind;
  text: string;
}

/** One numeric data point from a check-in (difficulty, day rating, energy…). */
export interface CoachMetric {
  /** ISO timestamp. */
  at: string;
  /** YYYY-MM-DD the metric belongs to. */
  date: string;
  /** e.g. "workout_difficulty", "day_rating", "day_energy" — 1–5 scales. */
  key: string;
  value: number;
}

/**
 * The coach's durable memory, one VFS doc (`coach.json`). Additive shape;
 * lists are capped on write so the doc never grows unbounded.
 */
export interface CoachMemory {
  v: 1;
  /** Durable facts/preferences ("hates burpees", "night-shift schedule"). */
  notes: string[];
  /** Model-maintained one-paragraph running summary of the user's journey. */
  summary?: string;
  /** Notable events, newest first. */
  events: CoachEvent[];
  /** Check-in metrics, newest first. */
  metrics: CoachMetric[];
}

export const EMPTY_MEMORY: CoachMemory = { v: 1, notes: [], events: [], metrics: [] };

// ── Check-ins ────────────────────────────────────────────────────────

export type CheckinKind = "workout" | "day";

/** One question from the hardcoded bank. `scale` renders 1–5 chips. */
export interface CoachQuestion {
  id: string;
  text: string;
  kind: "scale" | "text";
  /** Scale endpoint labels. */
  low?: string;
  high?: string;
  /** When set, a scale answer is logged as this CoachMetric key. */
  metricKey?: string;
}

/** A user's answer, carried verbatim into the evaluation prompt + memory. */
export interface CoachAnswer {
  id: string;
  question: string;
  /** Display value — "4/5" for scales, the raw text otherwise. */
  value: string;
  /** The numeric value for scale answers. */
  scale?: number;
  metricKey?: string;
}

// ── Context ──────────────────────────────────────────────────────────

/**
 * Everything the coach knows at prompt time. `rendered` is the compact
 * history block (recent food days, weight trend, sessions, check-ins, past
 * plans, memory) built once by context.ts and shared by every coach call.
 */
export interface CoachContext {
  plan: Plan | null;
  profile: Profile | null;
  goals: Goals;
  memory: CoachMemory;
  rendered: string;
}

/** Result of an evaluation or chat turn that may have touched the plan. */
export interface CoachOutcome {
  reply: string;
  /** Set when a validated plan adjustment was applied and persisted. */
  planUpdate?: { plan: Plan; summary: string };
}
