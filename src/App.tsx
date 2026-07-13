import { useCallback, useEffect, useMemo, useState } from "react";
import type { Goals, MealType, Plan, Profile } from "./types";
import { DEFAULT_GOALS } from "./types";
import { getRepository } from "./data/repository";
import { registerActions } from "./bridge/actions";
import { todayISO } from "./features/diary";
import {
  archivePlan,
  commitNewPlan,
  loadPlan,
  targetsToGoals,
  type WizardBody,
} from "./features/plan/planService";
import { DiaryScreen } from "./screens/DiaryScreen";
import { MealDetailScreen } from "./screens/MealDetailScreen";
import { WizardScreen } from "./screens/WizardScreen";
import { PlanBanner } from "./components/PlanBanner";
import { AddFoodScreen } from "./screens/AddFoodScreen";
import { TrendsScreen } from "./screens/TrendsScreen";
import { WorkoutsScreen } from "./screens/WorkoutsScreen";
import { SettingsSheet, type SettingsView } from "./screens/SettingsSheet";
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
  // v2: the active plan. null → show the "build your plan" banner (no longer a
  // full-screen gate; the app is usable for logging without a plan).
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ready, setReady] = useState(false);
  // Settings sheet: closed, or open on a specific sub-view (main / program editor).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>("main");
  // Plan wizard as a dismissible dialog, plus a per-session dismiss for its
  // banner (resets on reload = shows again while there's still no plan).
  const [planWizardOpen, setPlanWizardOpen] = useState(false);
  const [planBannerDismissed, setPlanBannerDismissed] = useState(false);
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
      const [g, p, existingPlan] = await Promise.all([repo.getGoals(), repo.getProfile(), loadPlan()]);
      if (!alive) return;
      setGoals(g);
      setProfile(p);
      setPlan(existingPlan);
      setReady(true);
    })();
    registerActions().catch(() => {
      /* cross-app integration is non-fatal */
    });
    return () => {
      alive = false;
    };
  }, []);

  // The diary's rings read from the plan's targets when it tracks food, falling
  // back to the separately-stored goals otherwise.
  const effectiveGoals = useMemo(() => targetsToGoals(plan, goals), [plan, goals]);

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

  const openSettings = useCallback((view: SettingsView = "main") => {
    setSettingsView(view);
    setSettingsOpen(true);
  }, []);

  const onLogged = useCallback(() => {
    setNonce((n) => n + 1);
    setTab(addReturn);
  }, [addReturn]);

  const onSaveGoals = useCallback((g: Goals, p: Profile | null) => {
    setGoals(g);
    if (p) setProfile(p);
  }, []);

  const onWizardComplete = useCallback(
    async (created: Plan, body: WizardBody) => {
      // Rebuilding over an existing plan: archive the outgoing one first so
      // history/insight survives (diary/weight/workout history is separate and
      // untouched).
      if (plan) await archivePlan(plan);
      const res = await commitNewPlan(created, { body, currentProfile: profile, currentGoals: goals });
      setPlan(res.plan);
      setProfile(res.profile);
      setGoals(res.goals);
      setPlanWizardOpen(false);
      setPlanBannerDismissed(false);
      setNonce((n) => n + 1);
      setTab("diary");
    },
    [plan, profile, goals],
  );

  const startNewPlan = useCallback(() => {
    setSettingsOpen(false);
    setPlanWizardOpen(true);
  }, []);

  // The plan wizard, opened from the banner, owns the screen while active but is
  // fully dismissible (no longer a mandatory first-run gate).
  if (ready && planWizardOpen) {
    return (
      <div className="app">
        <main className="screen">
          <WizardScreen
            onComplete={onWizardComplete}
            onClose={() => setPlanWizardOpen(false)}
            units={profile?.units ?? "metric"}
          />
        </main>
      </div>
    );
  }

  const loggingOnly = plan?.mode === "logging_only";

  const planBanner =
    ready && !plan && !planBannerDismissed ? (
      <PlanBanner onOpen={() => setPlanWizardOpen(true)} onDismiss={() => setPlanBannerDismissed(true)} />
    ) : null;

  const diaryScreen = (
    <DiaryScreen
      date={date}
      goals={effectiveGoals}
      banner={planBanner}
      nonce={nonce}
      onChangeDate={setDate}
      onAddToMeal={openAdd}
      onOpenMeal={openMeal}
      onMutated={() => setNonce((n) => n + 1)}
    />
  );

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
        <button className="icon-btn" aria-label="Settings" onClick={() => openSettings("main")}>
          <SettingsIcon size={20} />
        </button>
      </header>

      <main className="screen">
        {!ready ? (
          <div className="center-fill">
            <div className="spinner" />
          </div>
        ) : tab === "diary" ? (
          diaryScreen
        ) : tab === "meal" ? (
          <MealDetailScreen
            date={date}
            meal={activeMeal}
            goals={effectiveGoals}
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
          <WorkoutsScreen units={profile?.units ?? "metric"} onEditPlan={() => openSettings("program")} />
        ) : (
          diaryScreen
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
          plan={plan}
          initialView={settingsView}
          onClose={() => setSettingsOpen(false)}
          onSave={onSaveGoals}
          onPlanChange={setPlan}
          onStartNewPlan={startNewPlan}
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
