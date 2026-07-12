import { useCallback, useEffect, useState } from "react";
import type { Goals, MealType, Plan, Profile } from "./types";
import { DEFAULT_GOALS } from "./types";
import { getRepository } from "./data/repository";
import { registerActions } from "./bridge/actions";
import { todayISO } from "./features/diary";
import { DiaryScreen } from "./screens/DiaryScreen";
import { MealDetailScreen } from "./screens/MealDetailScreen";
import { WizardScreen } from "./screens/WizardScreen";
import { ProfileSetupWizard } from "./screens/ProfileSetupWizard";
import { SetupBanner } from "./components/SetupBanner";
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

type Tab = "diary" | "meal" | "add" | "trends" | "workouts";
type AddMode = "search" | "scan";

export function App() {
  const [tab, setTab] = useState<Tab>("diary");
  const [date, setDate] = useState<string>(todayISO());
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [backend, setBackend] = useState<"mock" | "supabase">("mock");
  // v2: the active plan. null → the first-run wizard gates the app.
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Guided profile/goals setup: the step id the wizard is open on (null = closed),
  // and a per-session dismiss for the Home banner (resets on reload = "shows again
  // when they open again").
  const [setupStep, setSetupStep] = useState<string | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  // The meal the Add flow should default to when opened from a meal's "+".
  const [addMeal, setAddMeal] = useState<MealType>("breakfast");
  // Which input the Add screen opens on (Scan when launched from a meal's Scan CTA).
  const [addMode, setAddMode] = useState<AddMode>("search");
  // Where the Add screen returns on log/cancel: back to the meal it came from,
  // or the diary. Keeps "add another to lunch" flowing without a detour.
  const [addReturn, setAddReturn] = useState<Tab>("diary");
  // The meal shown by the meal-detail screen.
  const [activeMeal, setActiveMeal] = useState<MealType>("breakfast");
  // Bumped after any write so the Diary reloads from the repository.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const repo = await getRepository();
      const [g, p, existingPlan] = await Promise.all([
        repo.getGoals(),
        repo.getProfile(),
        repo.getPlan().catch(() => null), // Supabase throws PLAN_REQUIRES_V2_BACKEND
      ]);
      if (!alive) return;
      setGoals(g);
      setProfile(p);
      setPlan(existingPlan);
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

  const openAdd = useCallback(
    (meal: MealType, mode: AddMode = "search", returnTo: Tab = "diary") => {
      setAddMeal(meal);
      setAddMode(mode);
      setAddReturn(returnTo);
      setTab("add");
    },
    [],
  );

  const openMeal = useCallback((meal: MealType) => {
    setActiveMeal(meal);
    setTab("meal");
  }, []);

  const onLogged = useCallback(() => {
    setNonce((n) => n + 1);
    setTab(addReturn);
  }, [addReturn]);

  const onSaveGoals = useCallback((g: Goals, p: Profile | null) => {
    setGoals(g);
    if (p) setProfile(p);
    setSettingsOpen(false);
  }, []);

  const onWizardComplete = useCallback(async (created: Plan) => {
    const repo = await getRepository();
    await repo.savePlan(created).catch(() => {
      /* Supabase throws PLAN_REQUIRES_V2_BACKEND; the mock persists it */
    });
    setPlan(created);
    setTab("diary");
  }, []);

  // First run (no plan yet): the wizard owns the whole screen — no tabs, no
  // topbar chrome — until a plan exists.
  if (ready && !plan) {
    return (
      <div className="app">
        <main className="screen">
          <WizardScreen onComplete={onWizardComplete} units={profile?.units ?? "metric"} />
        </main>
      </div>
    );
  }

  // Guided profile/goals setup (opened from the Home banner) owns the screen
  // while active, but is fully dismissible.
  if (ready && setupStep !== null) {
    return (
      <div className="app">
        <main className="screen">
          <ProfileSetupWizard
            profile={profile}
            goals={goals}
            initialStepId={setupStep}
            onSaved={(p, gg) => {
              setProfile(p);
              setGoals(gg);
            }}
            onClose={() => setSetupStep(null)}
          />
        </main>
      </div>
    );
  }

  const loggingOnly = plan?.mode === "logging_only";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Logo />
          </span>
          Conjure Health
        </div>
        <div className="topbar-spacer" />
        {backend === "mock" && <span className="env-pill" title="No backend session — data is local to this device">demo</span>}
        <button className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon size={20} />
        </button>
      </header>

      {ready && !setupDismissed && (
        <SetupBanner
          profile={profile}
          onStart={(stepId) => setSetupStep(stepId)}
          onDismiss={() => setSetupDismissed(true)}
        />
      )}

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
            onOpenMeal={openMeal}
            onMutated={() => setNonce((n) => n + 1)}
          />
        ) : tab === "meal" ? (
          <MealDetailScreen
            date={date}
            meal={activeMeal}
            goals={goals}
            nonce={nonce}
            onBack={() => setTab("diary")}
            onAdd={() => openAdd(activeMeal, "search", "meal")}
            onScan={() => openAdd(activeMeal, "scan", "meal")}
            onMutated={() => setNonce((n) => n + 1)}
          />
        ) : tab === "add" ? (
          <AddFoodScreen
            date={date}
            defaultMeal={addMeal}
            defaultMode={addMode}
            onLogged={onLogged}
            onCancel={() => setTab(addReturn)}
          />
        ) : tab === "trends" ? (
          <TrendsScreen profile={profile} />
        ) : tab === "workouts" && !loggingOnly ? (
          <WorkoutsScreen units={profile?.units ?? "metric"} />
        ) : (
          <DiaryScreen
            date={date}
            goals={goals}
            nonce={nonce}
            onChangeDate={setDate}
            onAddToMeal={openAdd}
            onOpenMeal={openMeal}
            onMutated={() => setNonce((n) => n + 1)}
          />
        )}
      </main>

      <nav className="tabbar">
        <TabButton label="Diary" Icon={DiaryIcon} active={tab === "diary" || tab === "meal"} onClick={() => setTab("diary")} />
        <TabButton label="Add" Icon={AddIcon} active={tab === "add"} onClick={() => openAdd(addMeal)} />
        <TabButton label="Trends" Icon={TrendsIcon} active={tab === "trends"} onClick={() => setTab("trends")} />
        {!loggingOnly && (
          <TabButton label="Workouts" Icon={WorkoutsIcon} active={tab === "workouts"} onClick={() => setTab("workouts")} />
        )}
      </nav>

      <div className="app-version">v{__APP_VERSION__}</div>

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
