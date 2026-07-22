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
import { DayCheckinBanner, DayCheckinSheet, isEvening } from "./components/DayCheckin";
import { recordPlanStarted } from "./features/coach/memory";
import { AddFoodScreen, type AddMode } from "./screens/AddFoodScreen";
import { PlanScreen } from "./screens/PlanScreen";
import { WorkoutsScreen } from "./screens/WorkoutsScreen";
import { CoachScreen } from "./screens/CoachScreen";
import { SettingsSheet, type SettingsView } from "./screens/SettingsSheet";
import { AppHeader } from "./components/AppHeader";
import {
  AddIcon,
  DiaryIcon,
  TrendsIcon,
  WorkoutsIcon,
} from "./components/icons";
import { MEAL_LABELS } from "./types";
import type { ComponentType } from "react";

type Tab = "diary" | "meal" | "add" | "plan" | "workouts" | "coach";

/** Sensible default meal when opening Add from the tab bar (no meal context) —
 *  by time of day. The user can still switch it in the Add screen. */
function mealForNow(): MealType {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snacks";
}

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
  // A question submitted from the Plan tab's coach launcher — handed to the
  // Coach chat so it opens already-answering. Cleared when consumed.
  const [coachInitialPrompt, setCoachInitialPrompt] = useState<string | null>(null);
  // Bumped after any write so the Diary reloads from the repository.
  const [nonce, setNonce] = useState(0);
  // End-of-day coach check-in (banner only): whether today is already checked
  // in, a per-session dismiss, and the sheet's open state.
  const [checkinDone, setCheckinDone] = useState(true);
  const [checkinDismissed, setCheckinDismissed] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);

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

  // Whether today's coach check-in exists (drives the evening banner).
  useEffect(() => {
    let alive = true;
    (async () => {
      const repo = await getRepository();
      const log = await repo.getDayLog(todayISO()).catch(() => null);
      if (alive) setCheckinDone(Boolean(log?.checkin));
    })();
    return () => {
      alive = false;
    };
  }, [nonce]);

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

  // Open the Coach chat from the Plan launcher, optionally auto-submitting a
  // starter question. Back from the chat returns to Plan.
  const openCoach = useCallback((question?: string) => {
    setCoachInitialPrompt(question ?? null);
    setTab("coach");
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
      // Coach continuity: the plan swap is a new episode on an unbroken
      // history — record it so the coach references the archive, not confusion.
      recordPlanStarted(res.plan, plan).catch(() => {});
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
            profile={profile}
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

  // Evening-only, banner-only (no notifications by design): nudge a coach
  // check-in until today has one.
  const checkinBanner =
    ready && !checkinDone && !checkinDismissed && isEvening() ? (
      <DayCheckinBanner onOpen={() => setCheckinOpen(true)} onDismiss={() => setCheckinDismissed(true)} />
    ) : null;

  const banners =
    planBanner || checkinBanner ? (
      <>
        {planBanner}
        {checkinBanner}
      </>
    ) : null;

  const diaryScreen = (
    <DiaryScreen
      date={date}
      goals={effectiveGoals}
      banner={banners}
      nonce={nonce}
      plan={plan}
      profile={profile}
      onChangeDate={setDate}
      onOpenMeal={openMeal}
      onOpenPlan={() => setTab("plan")}
    />
  );

  // Context-aware header: title + optional back per current surface.
  const header: { title: string; onBack?: () => void } =
    tab === "meal"
      ? { title: MEAL_LABELS[activeMeal], onBack: () => setTab("diary") }
      : tab === "add"
        ? {
            title: addMode === "scan" ? "Scan Barcode" : addMode === "ai" ? "AI" : "Search",
            onBack: () => setTab(addReturn),
          }
        : tab === "plan"
          ? { title: "Plan" }
          : tab === "workouts"
            ? { title: "Workouts" }
            : tab === "coach"
              ? { title: "Coach", onBack: () => setTab("plan") }
              : { title: "Conjure Health" };

  return (
    <div className="app">
      <AppHeader title={header.title} onBack={header.onBack} onSettings={() => openSettings("main")} />

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
            onScan={() => openAdd(activeMeal, "scan", "meal")}
            onSearch={() => openAdd(activeMeal, "search", "meal")}
            onAi={() => openAdd(activeMeal, "ai", "meal")}
            onMutated={() => setNonce((n) => n + 1)}
          />
        ) : tab === "add" ? (
          <AddFoodScreen
            date={date}
            defaultMeal={addMeal}
            defaultMode={addMode}
            onLogged={onLogged}
            onCancel={() => setTab(addReturn)}
            onModeChange={setAddMode}
          />
        ) : tab === "plan" ? (
          <PlanScreen
            profile={profile}
            plan={plan}
            units={profile?.units ?? "metric"}
            onPlanChange={setPlan}
            onAskCoach={openCoach}
            onEditPlan={() => openSettings("program")}
            onStartPlan={startNewPlan}
          />
        ) : tab === "workouts" && !loggingOnly ? (
          <WorkoutsScreen units={profile?.units ?? "metric"} plan={plan} onPlanChange={setPlan} />
        ) : tab === "coach" ? (
          <CoachScreen onPlanChange={setPlan} initialPrompt={coachInitialPrompt} />
        ) : (
          diaryScreen
        )}
      </main>

      <nav className="tabbar">
        <TabButton label="Diary" Icon={DiaryIcon} active={tab === "diary" || tab === "meal"} onClick={() => setTab("diary")} />
        <TabButton label="Add" Icon={AddIcon} active={tab === "add"} onClick={() => openAdd(mealForNow())} />
        <TabButton label="Plan" Icon={TrendsIcon} active={tab === "plan" || tab === "coach"} onClick={() => setTab("plan")} />
        {!loggingOnly && (
          <TabButton label="Workouts" Icon={WorkoutsIcon} active={tab === "workouts"} onClick={() => setTab("workouts")} />
        )}
      </nav>

      <div className="app-version">v{__APP_VERSION__}</div>

      {checkinOpen && (
        <DayCheckinSheet
          date={todayISO()}
          onClose={() => setCheckinOpen(false)}
          onComplete={() => {
            setCheckinDone(true);
            setNonce((n) => n + 1);
          }}
          onPlanChange={setPlan}
        />
      )}

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
