import { useCallback, useEffect, useState } from "react";
import type { Goals, MealType, Profile } from "./types";
import { DEFAULT_GOALS } from "./types";
import { getRepository } from "./data/repository";
import { registerActions } from "./bridge/actions";
import { todayISO } from "./features/diary";
import { DiaryScreen } from "./screens/DiaryScreen";
import { AddFoodScreen } from "./screens/AddFoodScreen";
import { TrendsScreen } from "./screens/TrendsScreen";
import { WorkoutsScreen } from "./screens/WorkoutsScreen";
import { SettingsSheet } from "./screens/SettingsSheet";
import {
  AddIcon,
  DiaryIcon,
  Logo,
  SettingsIcon,
  TrendsIcon,
  WorkoutsIcon,
} from "./components/icons";
import type { ComponentType } from "react";

type Tab = "diary" | "add" | "trends" | "workouts";

export function App() {
  const [tab, setTab] = useState<Tab>("diary");
  const [date, setDate] = useState<string>(todayISO());
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [backend, setBackend] = useState<"mock" | "supabase">("mock");
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The meal the Add flow should default to when opened from a meal's "+".
  const [addMeal, setAddMeal] = useState<MealType>("breakfast");
  // Bumped after any write so the Diary reloads from the repository.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const repo = await getRepository();
      const [g, p] = await Promise.all([repo.getGoals(), repo.getProfile()]);
      if (!alive) return;
      setGoals(g);
      setProfile(p);
      setBackend(repo.kind);
      setReady(true);
    })();
    registerActions().catch(() => {
      /* cross-app integration is non-fatal */
    });
    return () => {
      alive = false;
    };
  }, []);

  const openAdd = useCallback((meal: MealType) => {
    setAddMeal(meal);
    setTab("add");
  }, []);

  const onLogged = useCallback(() => {
    setNonce((n) => n + 1);
    setTab("diary");
  }, []);

  const onSaveGoals = useCallback((g: Goals, p: Profile | null) => {
    setGoals(g);
    if (p) setProfile(p);
    setSettingsOpen(false);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Logo />
          </span>
          Conjure Fitness
        </div>
        <div className="topbar-spacer" />
        {backend === "mock" && <span className="env-pill" title="No backend session — data is local to this device">demo</span>}
        <button className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon size={20} />
        </button>
      </header>

      <main className="screen">
        {!ready ? (
          <div className="center-fill">
            <div className="spinner" />
          </div>
        ) : tab === "diary" ? (
          <DiaryScreen
            date={date}
            goals={goals}
            nonce={nonce}
            onChangeDate={setDate}
            onAddToMeal={openAdd}
            onMutated={() => setNonce((n) => n + 1)}
          />
        ) : tab === "add" ? (
          <AddFoodScreen
            date={date}
            defaultMeal={addMeal}
            onLogged={onLogged}
            onCancel={() => setTab("diary")}
          />
        ) : tab === "trends" ? (
          <TrendsScreen profile={profile} />
        ) : (
          <WorkoutsScreen />
        )}
      </main>

      <nav className="tabbar">
        <TabButton label="Diary" Icon={DiaryIcon} active={tab === "diary"} onClick={() => setTab("diary")} />
        <TabButton label="Add" Icon={AddIcon} active={tab === "add"} onClick={() => openAdd(addMeal)} />
        <TabButton label="Trends" Icon={TrendsIcon} active={tab === "trends"} onClick={() => setTab("trends")} />
        <TabButton label="Workouts" Icon={WorkoutsIcon} active={tab === "workouts"} onClick={() => setTab("workouts")} />
      </nav>

      {settingsOpen && (
        <SettingsSheet
          goals={goals}
          profile={profile}
          onClose={() => setSettingsOpen(false)}
          onSave={onSaveGoals}
        />
      )}
    </div>
  );
}

function TabButton({
  label,
  Icon,
  active,
  onClick,
}: {
  label: string;
  Icon: ComponentType<{ size?: number }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`tab${active ? " active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span className="tab-icon" aria-hidden>
        <Icon size={22} />
      </span>
      <span className="tab-label">{label}</span>
    </button>
  );
}
