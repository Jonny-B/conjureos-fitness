import { useEffect, useState } from "react";
import type { Plan, Profile, Workout } from "../types";
import { BUILT_IN_WORKOUTS } from "../features/workouts";
import { formatDay, todayISO } from "../features/diary";
import { fmtDuration } from "../features/units";
import {
  listCompletedWorkouts,
  removeSession,
  setSessionKcal,
  excludeWearable,
  restoreWearable,
  setWearableKcal,
  addManualExercise,
  manualExerciseProblem,
  EXERCISE_PRESETS,
  presetKcal,
  type CompletedWorkout,
  type ExercisePreset,
} from "../features/exercise";
import { NumberField } from "../components/NumberField";
import { AddIcon, PlayIcon, CloseIcon, TrashIcon } from "../components/icons";
import { WorkoutRunner, metaLine } from "./WorkoutRunner";

/**
 * Workouts tab — a library of ready-to-run workouts PLUS a "Completed today"
 * list that combines in-app sessions and wearable/Apple-Health workouts. From
 * there the user can adjust a workout's burned calories or remove it from the
 * day's total (wearable removals are local + reversible; see features/exercise),
 * and add one: a basic workout with predefined calories, or anything typed in.
 *
 * In `exerciseOnly` mode (the coach/workout pause — see features/flags) the
 * library and the runner are gone and only the completed list and the adding
 * render. Apple Health calories still feed the calorie ring while the coach is
 * paused, so the user must keep a way to see and correct the numbers moving
 * their budget, and a way to add exercise their watch didn't catch; this screen
 * is that surface, reached from the Workouts tab and the ring's Exercise row.
 */
export function WorkoutsScreen({
  units,
  plan,
  onPlanChange,
  date = todayISO(),
  nonce = 0,
  onMutated,
  exerciseOnly = false,
}: {
  units: Profile["units"];
  plan: Plan | null;
  onPlanChange: (plan: Plan | null) => void;
  date?: string;
  nonce?: number;
  onMutated?: () => void;
  /** Render only the completed-workouts list — no library, no runner. */
  exerciseOnly?: boolean;
}) {
  const [running, setRunning] = useState<Workout | null>(null);

  if (exerciseOnly) {
    return (
      <div className="workouts">
        <h1 className="screen-title">Workouts</h1>
        <p className="muted small">
          Exercise you add here or sync from Apple Health and other wearables. Calories burned
          are added back to your daily budget. Edit or remove anything that looks wrong.
        </p>
        <CompletedToday date={date} nonce={nonce} onMutated={onMutated} />
      </div>
    );
  }

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
  // The Add sheet: closed, blank ("custom"), or filled in from a preset.
  const [adding, setAdding] = useState<ExercisePreset | "custom" | null>(null);
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
  // Name the day when it isn't today: the tab adds to whichever day the diary
  // is showing, and a walk filed under yesterday never moves today's ring.
  const heading = date === todayISO() ? "Completed today" : `Completed on ${formatDay(date)}`;

  const addSection = <AddWorkout onPick={setAdding} />;
  const addModal = adding && (
    <AddExerciseModal
      key={adding === "custom" ? "custom" : adding.id}
      date={date}
      preset={adding === "custom" ? undefined : adding}
      hasWearable={(items ?? []).some((i) => i.source === "wearable" && !i.excluded)}
      onClose={() => setAdding(null)}
      onDone={() => {
        setAdding(null);
        refresh();
      }}
    />
  );

  if (items && items.length === 0) {
    return (
      <section className="completed-today">
        <h2 className="screen-subtitle">{heading}</h2>
        <p className="muted small">No workouts logged for this day yet.</p>
        {addSection}
        {addModal}
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
                  <span className={`source-pill source-${it.source}`}>{it.sourceLabel}</span>
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
                    <span className={`source-pill source-${it.source}`}>{it.sourceLabel}</span>
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

      {items != null && addSection}
      {addModal}

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
 * The ways to add exercise: a basic workout with predefined calories, or
 * anything else typed in by hand. Both open the Add sheet, a preset already
 * filled in.
 */
function AddWorkout({ onPick }: { onPick: (pick: ExercisePreset | "custom") => void }) {
  return (
    <div className="add-workout">
      <h2 className="screen-subtitle">Add a workout</h2>
      <ul className="preset-list">
        {EXERCISE_PRESETS.map((p) => (
          <li key={p.id}>
            <button className="preset-row" onClick={() => onPick(p)}>
              <span className="preset-main">
                <span className="preset-name">{p.name}</span>
                <span className="preset-meta">
                  {p.minutes} min · {p.kcal} cal
                </span>
              </span>
              <span className="preset-add" aria-hidden>
                <AddIcon size={16} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn block add-exercise-btn" onClick={() => onPick("custom")}>
        Add something else
      </button>
    </div>
  );
}

/**
 * Log an exercise by hand: name, optional minutes, calories burned. Calories
 * are typed in rather than estimated, so adding one never costs anything.
 * Opened from a preset, the form starts filled in and the calories follow the
 * minutes until the user types calories of their own.
 */
function AddExerciseModal({
  date,
  preset,
  hasWearable,
  onClose,
  onDone,
}: {
  date: string;
  /** The basic workout picked; absent for a blank entry. */
  preset?: ExercisePreset;
  hasWearable: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(preset?.name ?? "");
  const [minutes, setMinutes] = useState<number | undefined>(preset?.minutes);
  const [kcal, setKcal] = useState<number | undefined>(preset?.kcal);
  const [kcalTyped, setKcalTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeMinutes = (m: number | undefined) => {
    setMinutes(m);
    if (preset && !kcalTyped && m !== undefined && m > 0) setKcal(presetKcal(preset, m));
  };
  const changeKcal = (k: number | undefined) => {
    if (k !== kcal) setKcalTyped(true);
    setKcal(k);
  };

  const save = async () => {
    const input = { name, durationMin: minutes, calories: kcal ?? 0 };
    const problem = manualExerciseProblem({ ...input, calories: kcal });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addManualExercise(date, input);
      onDone();
    } catch {
      setError("Couldn't save this exercise. Nothing was added. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet compact" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Add exercise</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </header>
        <div className="sheet-body">
          <label className="field">
            <span>What did you do?</span>
            <input
              className="text-input"
              type="text"
              value={name}
              maxLength={60}
              placeholder="e.g. Evening walk"
              onChange={(e) => setName(e.target.value)}
              aria-label="Exercise name"
            />
          </label>
          <label className="field">
            <span>Minutes (optional)</span>
            <NumberField value={minutes} min={0} max={1440} onChange={changeMinutes} aria-label="Minutes" />
          </label>
          <label className="field">
            <span>Calories burned</span>
            <NumberField value={kcal} min={0} max={5000} onChange={changeKcal} aria-label="Calories burned" />
          </label>
          {preset && (
            <p className="muted small">
              A typical burn at a moderate pace. Change the minutes and the calories follow, or type your
              own.
            </p>
          )}
          {hasWearable && (
            <p className="muted small">
              If your watch already synced this workout, adding it here counts it twice. Edit the synced one
              instead.
            </p>
          )}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
        </div>
        <footer className="sheet-foot">
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Add"}
          </button>
        </footer>
      </div>
    </div>
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
