import { useCallback, useEffect, useMemo, useState } from "react";
import type { DraftEntry, Entry, EntryKind, Goals, Meal } from "../lib/types";
import { DEFAULT_GOALS, defaultMeal } from "../lib/types";
import {
  addEntries,
  deleteEntry,
  getGoals,
  listEntries,
  listEntriesInRange,
  saveGoals,
  updateEntry,
  ymd,
} from "../lib/api";
import { backend, isDemo } from "../lib/backend";
import type { AppSession } from "../lib/backend/types";
import { mealTotals, totalsFor } from "../lib/macros";
import DaySummary from "./DaySummary";
import LogInput from "./LogInput";
import EntryList from "./EntryList";
import WeeklyChart, { type DayBar } from "./WeeklyChart";
import GoalsModal from "./GoalsModal";
import Settings from "./Settings";

const DAY_MS = 86_400_000;
const shift = (date: string, days: number) => ymd(new Date(new Date(date + "T00:00:00").getTime() + days * DAY_MS));
const prettyDate = (date: string) => {
  const today = ymd();
  if (date === today) return "Today";
  if (date === shift(today, -1)) return "Yesterday";
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

export default function Dashboard({ session }: { session: AppSession }) {
  const [day, setDay] = useState(ymd());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [week, setWeek] = useState<Entry[]>([]);
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [editingGoals, setEditingGoals] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logKind, setLogKind] = useState<EntryKind>("food");
  const [logMeal, setLogMeal] = useState<Meal>(defaultMeal());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekStart = useMemo(() => shift(ymd(), -6), []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [dayEntries, weekEntries] = await Promise.all([
        listEntries(day),
        listEntriesInRange(weekStart, ymd()),
      ]);
      setEntries(dayEntries);
      setWeek(weekEntries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your log.");
    } finally {
      setLoading(false);
    }
  }, [day, weekStart]);

  useEffect(() => {
    getGoals().then(setGoals).catch(() => setGoals(DEFAULT_GOALS));
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const totals = useMemo(() => totalsFor(entries), [entries]);
  const meals = useMemo(() => mealTotals(entries), [entries]);

  const weekBars: DayBar[] = useMemo(() => {
    const byDate = new Map<string, Entry[]>();
    for (const e of week) {
      const arr = byDate.get(e.entry_date) ?? [];
      arr.push(e);
      byDate.set(e.entry_date, arr);
    }
    const bars: DayBar[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = shift(ymd(), -i);
      bars.push({ date: d, net: totalsFor(byDate.get(d) ?? []).net });
    }
    return bars;
  }, [week]);

  const handleLogged = async (drafts: DraftEntry[]) => {
    await addEntries(day, drafts);
    await refresh();
  };

  const handleUpdate = async (id: string, patch: Partial<Entry>) => {
    await updateEntry(id, patch);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    await refresh();
  };

  const handleSaveGoals = async (next: Goals) => {
    await saveGoals(next);
    setGoals(next);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand brand-sm">
          <span className="brand-mark" aria-hidden>◗</span>
          <span className="brand-name">Fitness</span>
          {isDemo && <span className="demo-badge">demo</span>}
        </div>
        <button
          className="avatar"
          onClick={() => setSettingsOpen(true)}
          aria-label="Account and settings"
          title="Account and settings"
        >
          {avatarInitial(session.user.email)}
        </button>
      </header>

      <main className="content">
        <div className="daynav">
          <button className="daynav-btn" onClick={() => setDay(shift(day, -1))} aria-label="Previous day">
            ‹
          </button>
          <div className="daynav-label">
            <span className="daynav-date">{prettyDate(day)}</span>
            {day !== ymd() && (
              <button className="link-btn" onClick={() => setDay(ymd())}>
                Jump to today
              </button>
            )}
          </div>
          <button
            className="daynav-btn"
            onClick={() => setDay(shift(day, 1))}
            disabled={day >= ymd()}
            aria-label="Next day"
          >
            ›
          </button>
        </div>

        {error && <p className="notice notice-err">{error}</p>}

        <DaySummary
          totals={totals}
          meals={meals}
          goals={goals}
          activeMeal={logMeal}
          onSelectMeal={(m) => {
            setLogKind("food");
            setLogMeal(m);
          }}
          onEditGoals={() => setEditingGoals(true)}
        />
        <LogInput
          kind={logKind}
          meal={logMeal}
          onKindChange={setLogKind}
          onMealChange={setLogMeal}
          onLogged={handleLogged}
        />

        {loading ? (
          <section className="card empty"><p>Loading your log…</p></section>
        ) : (
          <EntryList entries={entries} onUpdate={handleUpdate} onDelete={handleDelete} />
        )}

        <WeeklyChart days={weekBars} goals={goals} selected={day} onSelect={setDay} />

        <footer className="foot">
          Estimates aren't precise — they're a fast starting point you can adjust.
        </footer>
      </main>

      {settingsOpen && (
        <Settings
          email={session.user.email}
          goals={goals}
          isDemo={isDemo}
          onEditGoals={() => setEditingGoals(true)}
          onSignOut={() => backend.signOut()}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {editingGoals && (
        <GoalsModal goals={goals} onSave={handleSaveGoals} onClose={() => setEditingGoals(false)} />
      )}
    </div>
  );
}

function avatarInitial(email: string | null): string {
  const c = (email ?? "").trim().charAt(0).toUpperCase();
  return c || "◗";
}
