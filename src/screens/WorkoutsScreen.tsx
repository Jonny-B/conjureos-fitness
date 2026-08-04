import { useEffect, useState } from "react";
import type { Plan, Profile, Workout } from "../types";
import { BUILT_IN_WORKOUTS } from "../features/workouts";
import { todayISO } from "../features/diary";
import { fmtDuration } from "../features/units";
import {
  listCompletedWorkouts,
  removeSession,
  setSessionKcal,
  excludeWearable,
  restoreWearable,
  setWearableKcal,
  type CompletedWorkout,
} from "../features/exercise";
import { NumberField } from "../components/NumberField";
import { PlayIcon, CloseIcon, TrashIcon } from "../components/icons";
import { WorkoutRunner, metaLine } from "./WorkoutRunner";

/**
 * Workouts tab — a library of ready-to-run workouts PLUS a "Completed today"
 * list that combines in-app sessions and wearable/Apple-Health workouts. From
 * there the user can adjust a workout's burned calories or remove it from the
 * day's total (wearable removals are local + reversible; see features/exercise).
 */
export function WorkoutsScreen({
  units,
  plan,
  onPlanChange,
  date = todayISO(),
  nonce = 0,
  onMutated,
}: {
  units: Profile["units"];
  plan: Plan | null;
  onPlanChange: (plan: Plan | null) => void;
  date?: string;
  nonce?: number;
  onMutated?: () => void;
}) {
  const [running, setRunning] = useState<Workout | null>(null);

  if (running) {
    return (
      <WorkoutRunner
        workout={running}
        plan={plan}
        units={units}
        onPlanChange={onPlanChange}
        onExit={() => {
          setRunning(null);
          onMutated?.();
        }}
      />
    );
  }

  return (
    <div className="workouts">
      <h1 className="screen-title">Workouts</h1>

      <CompletedToday date={date} nonce={nonce} onMutated={onMutated} />

      <h2 className="screen-subtitle">Start a workout</h2>
      <ul className="workout-list">
        {BUILT_IN_WORKOUTS.map((w) => (
          <li key={w.id}>
            <button className="workout-card" onClick={() => setRunning(w)}>
              <div className="workout-card-text">
                <div className="workout-name">{w.name}</div>
                <div className="workout-summary">{w.summary}</div>
                <div className="workout-meta">{metaLine(w)}</div>
              </div>
              <span className="workout-play" aria-hidden>
                <PlayIcon size={18} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompletedToday({
  date,
  nonce,
  onMutated,
}: {
  date: string;
  nonce: number;
  onMutated?: () => void;
}) {
  const [items, setItems] = useState<CompletedWorkout[] | null>(null);
  const [editing, setEditing] = useState<CompletedWorkout | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    listCompletedWorkouts(date)
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [date, nonce, tick]);

  const refresh = () => {
    setTick((t) => t + 1);
    onMutated?.();
  };

  const active = (items ?? []).filter((i) => !i.excluded);
  const removed = (items ?? []).filter((i) => i.excluded);
  const total = active.reduce((n, i) => n + (i.kcal || 0), 0);
  const heading = date === todayISO() ? "Completed today" : "Completed";

  if (items && items.length === 0) {
    return (
      <section className="completed-today">
        <h2 className="screen-subtitle">{heading}</h2>
        <p className="muted small">No workouts logged for this day yet.</p>
      </section>
    );
  }

  return (
    <section className="completed-today">
      <div className="completed-head">
        <h2 className="screen-subtitle">{heading}</h2>
        {active.length > 0 && <span className="completed-total">{total} cal</span>}
      </div>

      {items == null ? (
        <div className="spinner" />
      ) : (
        <ul className="completed-list">
          {active.map((it) => (
            <li key={it.key} className="completed-row">
              <div className="completed-main">
                <div className="completed-name">
                  {it.name}
                  <span className={`source-pill ${it.source}`}>{it.sourceLabel}</span>
                </div>
                <div className="completed-meta muted small">
                  {[fmtDuration(it.durationSec), `${it.kcal} cal`].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="completed-actions">
                <button className="link-btn" onClick={() => setEditing(it)}>
                  Edit
                </button>
                <button
                  className="icon-btn danger-text"
                  aria-label={`${it.source === "app" ? "Delete" : "Remove"} ${it.name}`}
                  onClick={async () => {
                    if (it.source === "app") await removeSession(it.key);
                    else await excludeWearable(date, it.key);
                    refresh();
                  }}
                >
                  <TrashIcon size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {removed.length > 0 && (
        <details className="removed-block">
          <summary className="muted small">Removed from total ({removed.length})</summary>
          <ul className="completed-list">
            {removed.map((it) => (
              <li key={it.key} className="completed-row removed">
                <div className="completed-main">
                  <div className="completed-name">
                    {it.name}
                    <span className={`source-pill ${it.source}`}>{it.sourceLabel}</span>
                  </div>
                  <div className="completed-meta muted small">{it.kcal} cal · not counted</div>
                </div>
                <button
                  className="link-btn"
                  onClick={async () => {
                    await restoreWearable(date, it.key);
                    refresh();
                  }}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {editing && (
        <CompletedEditModal
          date={date}
          item={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

/**
 * Edit a completed workout's burned calories, or remove it from the day. In-app
 * sessions are saved/deleted for real; wearable workouts get a local kcal
 * override / exclusion (we can't write back to Apple Health).
 */
function CompletedEditModal({
  date,
  item,
  onClose,
  onDone,
}: {
  date: string;
  item: CompletedWorkout;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kcal, setKcal] = useState<number | undefined>(item.kcal);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const v = Math.max(0, Math.round(kcal ?? 0));
      if (item.source === "app") await setSessionKcal(item.key, v);
      else await setWearableKcal(date, item.key, v);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      if (item.source === "app") await removeSession(item.key);
      else await excludeWearable(date, item.key);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet compact" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{item.name}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </header>
        <div className="sheet-body">
          <p className="muted small">
            {item.source === "app"
              ? "Your in-app workout."
              : `From ${item.sourceLabel}. Editing here only changes what ConjureOS counts — it won't change Apple Health.`}
          </p>
          <label className="field">
            <span>Calories burned</span>
            <NumberField value={kcal} min={0} max={5000} onChange={setKcal} aria-label="Calories burned" />
          </label>
        </div>
        <footer className="sheet-foot">
          <button className="btn danger" disabled={busy} onClick={() => void remove()}>
            <TrashIcon size={16} /> {item.source === "app" ? "Delete" : "Remove"}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
