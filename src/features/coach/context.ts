/**
 * Coach context assembly — one compact snapshot of everything the coach may
 * reason about: the active plan, recent workout sessions, check-in history,
 * archived (past) plans, and the coach's own memory. Built once per surface and shared by every coach call
 * in that surface so the prompts stay consistent.
 */

import type { DailyCheckoff, Plan, WorkoutSession } from "../../types";
import { getRepository } from "../../data/repository";
import { readJson } from "../../bridge/vfs";
import { shiftDate, todayISO } from "../dates";
import { normalizeExerciseKey } from "../explainers/normalizeKey";
import { summarize } from "../workoutHistory";
import { loadMemory } from "./memory";
import type { CoachContext } from "./model";

const ARCHIVE_PATH = "plan-archive.json";
const CHECKIN_DAYS = 7;
const SESSION_WINDOW = 8;

/**
 * Assemble everything the coach is allowed to know: active plan, profile,
 * recent sessions, recent check-ins, its own memory, and archived plans. Every read is individually fault-tolerant — a missing or failing
 * store degrades that slice to a default rather than failing the whole turn,
 * so the coach still answers with partial context.
 */
export async function buildCoachContext(): Promise<CoachContext> {
  const repo = await getRepository();
  const today = todayISO();

  const [plan, profile, sessions, memory, archived] = await Promise.all([
    repo.getPlan().catch(() => null),
    repo.getProfile().catch(() => null),
    repo.listWorkoutSessions(SESSION_WINDOW).catch(() => [] as WorkoutSession[]),
    loadMemory(),
    readJson<Plan[]>(ARCHIVE_PATH, []),
  ]);
  // The last few days' check-offs, oldest first (the evening check-ins).
  const days: string[] = [];
  for (let i = CHECKIN_DAYS - 1; i >= 0; i--) days.push(shiftDate(today, -i));
  const dayLogs = await Promise.all(days.map((d) => repo.getDayLog(d).catch(() => null)));
  const rendered = render({ plan, sessions, archived, dayLogs, today });
  return { plan, profile, memory, rendered };
}

function render(x: {
  plan: Plan | null;
  sessions: WorkoutSession[];
  archived: Plan[];
  dayLogs: (DailyCheckoff | null)[];
  today: string;
}): string {
  const lines: string[] = [];
  lines.push(`Today: ${x.today}.`);

  if (x.plan) {
    const p = x.plan;
    lines.push(
      `Active plan: ${p.mode}, ${p.startDate} → ${p.endDate}. Goals: ${p.goals.map((g) => g.label).join("; ")}.`,
    );
    const prog = p.program;
    if (prog) {
      lines.push(`Program workouts: ${prog.workouts.map((w) => w.workout.name).join(", ")}.`);
      const keys = new Set<string>();
      for (const pw of prog.workouts)
        for (const ex of pw.workout.exercises) keys.add(normalizeExerciseKey(ex.name));
      if (keys.size)
        lines.push(`Program exercise keys (for plan adjustments, use these exactly): ${[...keys].join(", ")}.`);
      for (const b of prog.benchmarks) {
        const latest = b.history.at(-1)?.value;
        lines.push(
          `Benchmark ${b.name} (key ${b.exerciseKey}): baseline ${b.baseline ?? "unset"}, now ${latest ?? "—"}, target ${b.target} ${b.unit}${b.lowerIsBetter ? " (lower is better)" : ""}.`,
        );
      }
    }
  } else {
    lines.push("No active plan yet.");
  }

  if (x.sessions.length) {
    const sLines = x.sessions.map((s) => {
      if (s.cardio)
        return `  ${s.date}: cardio ${s.cardio.distanceKm.toFixed(2)} km in ${Math.round(s.cardio.durationSec / 60)} min`;
      const st = summarize(s.byExercise ?? []);
      const rpes = (s.byExercise ?? []).flatMap((e) => e.sets.map((set) => set.rpe)).filter((v): v is number => v != null);
      const rpe = rpes.length ? `, avg RPE ${(rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1)}` : "";
      return `  ${s.date}: ${st.totalSets} sets, ${st.totalReps} reps, ${Math.round(st.totalVolumeKg)} kg volume${rpe}`;
    });
    lines.push(`Recent workouts (newest first):\n${sLines.join("\n")}`);
  } else {
    lines.push("No workouts recorded yet.");
  }

  const checkins = x.dayLogs
    .filter((l): l is DailyCheckoff => Boolean(l?.checkin))
    .map((l) => `  ${l.date}: ${l.checkin!.answers.map((a) => `${a.question} → ${a.answer}`).join(" · ")}`);
  if (checkins.length) lines.push(`Recent day check-ins:\n${checkins.join("\n")}`);

  if (x.archived.length) {
    const past = x.archived
      .slice(0, 3)
      .map((p) => `  ${p.startDate} → ${p.endDate} (${p.mode}): ${p.goals.slice(0, 3).map((g) => g.label).join("; ")}`);
    lines.push(`Past plans (archived):\n${past.join("\n")}`);
  }

  return lines.join("\n");
}

/** The memory block appended to every coach prompt (kept separate from the
 *  history so prompts can order them consistently). */
export function renderMemory(ctx: CoachContext): string {
  const m = ctx.memory;
  const lines: string[] = [];
  if (m.summary) lines.push(`Running summary: ${m.summary}`);
  if (m.notes.length) lines.push(`Notes to remember:\n${m.notes.map((n) => `  - ${n}`).join("\n")}`);
  const ev = m.events.slice(0, 10);
  if (ev.length) lines.push(`Recent events:\n${ev.map((e) => `  ${e.at.slice(0, 10)} [${e.kind}] ${e.text}`).join("\n")}`);
  const met = m.metrics.slice(0, 14);
  if (met.length) lines.push(`Recent check-in metrics (1–5):\n${met.map((v) => `  ${v.date} ${v.key}=${v.value}`).join("\n")}`);
  return lines.length ? lines.join("\n") : "(no coach memory yet)";
}
