import { useCallback, useEffect, useRef, useState } from "react";
import type { Plan, Profile } from "./types";
import { getRepository } from "./data/repository";
import { registerActions } from "./bridge/actions";
import { todayISO } from "./features/dates";
import { rollSelectedDate } from "./features/dayRollover";
import { onDataChanged } from "./features/dataEvents";
import {
  archivePlan,
  commitNewPlan,
  loadPlan,
  modifyPlanInPlace,
  type WizardBody,
} from "./features/plan/planService";
import { WizardScreen } from "./screens/WizardScreen";
import { PlanBanner } from "./components/PlanBanner";
import { DayCheckinBanner, DayCheckinSheet, isEvening } from "./components/DayCheckin";
import { recordPlanStarted } from "./features/coach/memory";
import { PlanScreen } from "./screens/PlanScreen";
import { WorkoutsScreen } from "./screens/WorkoutsScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { CoachScreen } from "./screens/CoachScreen";
import { SettingsSheet, type SettingsView } from "./screens/SettingsSheet";
import { AppHeader } from "./components/AppHeader";
import { SaveFailedNotice } from "./components/SaveFailedNotice";
import { CoachIcon, HomeIcon, TrendsIcon, WorkoutsIcon } from "./components/icons";
import type { ComponentType } from "react";

type Tab = "home" | "plan" | "workouts" | "coach";

/**
 * Root component and the app's single source of navigation + shared state.
 *
 * Owns the active tab, the selected date, and the cached profile/plan that most
 * screens read, passing them down rather than letting screens hit the
 * repository independently. A `nonce` counter is bumped after any write so
 * mounted children re-read; that's the app-wide invalidation signal.
 */
export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [date, setDate] = useState<string>(todayISO());
  const [profile, setProfile] = useState<Profile | null>(null);
  // Units picked in Settings before any profile exists; every screen uses them
  // until the first plan saves a profile.
  const [pendingUnits, setPendingUnits] = useState<Profile["units"]>("metric");
  // The active plan. null → show the "build your plan" banner; the app is
  // usable without a plan (the workout library, the coach).
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ready, setReady] = useState(false);
  // Settings sheet: closed, or open on a specific sub-view (main / program editor).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>("main");
  // Plan wizard as a dismissible dialog, plus a per-session dismiss for its
  // banner (resets on reload = shows again while there's still no plan).
  const [planWizardOpen, setPlanWizardOpen] = useState(false);
  // The plan currently being edited (edit mode) vs null = create-a-new-plan.
  // Both open the same full-screen WizardScreen.
  const [planEditor, setPlanEditor] = useState<Plan | null>(null);
  const [planBannerDismissed, setPlanBannerDismissed] = useState(false);
  // A question submitted from a coach launcher — handed to the Coach chat so it
  // opens already-answering. Cleared when consumed.
  const [coachInitialPrompt, setCoachInitialPrompt] = useState<string | null>(null);
  // Bumped after any write so mounted screens reload from the repository.
  const [nonce, setNonce] = useState(0);
  // End-of-day coach check-in (banner only): whether today is already checked
  // in, a per-session dismiss, and the sheet's open state.
  const [checkinDone, setCheckinDone] = useState(true);
  const [checkinDismissed, setCheckinDismissed] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  // The local day and whether it is evening, kept current while the app stays
  // open (see the clock effect below) so nothing is keyed to the launch day.
  const [today, setToday] = useState<string>(todayISO());
  const [evening, setEvening] = useState<boolean>(isEvening());
  const prevToday = useRef(today);

  const units = profile?.units ?? pendingUnits;

  /**
   * Re-read everything a reset can have changed. Bumping `nonce` alone only
   * makes mounted screens refetch THEIR data — the plan lives in App state, so
   * clearing it left the Plan tab rendering a plan that no longer existed.
   */
  const onDataCleared = useCallback(async () => {
    const repo = await getRepository();
    const [p, existingPlan] = await Promise.all([repo.getProfile(), loadPlan()]);
    setProfile(p);
    setPlan(existingPlan);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const repo = await getRepository();
      const [p, existingPlan] = await Promise.all([repo.getProfile(), loadPlan()]);
      if (!alive) return;
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

  // Re-read the clock when the app returns to the foreground and once a minute,
  // so a session left open across midnight (or into the evening) catches up.
  useEffect(() => {
    const sync = () => {
      setToday(todayISO());
      setEvening(isEvening());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    const id = window.setInterval(sync, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
      window.clearInterval(id);
    };
  }, []);

  // New local day: a selected date that was "today" follows it (a date the user
  // picked does not jump), and yesterday's check-in dismissal no longer applies.
  useEffect(() => {
    const prev = prevToday.current;
    if (prev === today) return;
    prevToday.current = today;
    setDate((d) => rollSelectedDate(d, prev, today));
    setCheckinDismissed(false);
  }, [today]);
  // A write from another app (logWorkout) happens outside React: re-read.
  useEffect(() => onDataChanged(() => setNonce((n) => n + 1)), []);

  // Whether today's coach check-in exists (drives the evening banner).
  useEffect(() => {
    let alive = true;
    (async () => {
      const repo = await getRepository();
      const log = await repo.getDayLog(today).catch(() => null);
      if (alive) setCheckinDone(Boolean(log?.checkin));
    })();
    return () => {
      alive = false;
    };
  }, [nonce, today]);

  // Open the Coach chat, optionally auto-submitting a starter question.
  const openCoach = useCallback((question?: string) => {
    setCoachInitialPrompt(question ?? null);
    setTab("coach");
  }, []);

  const openSettings = useCallback((view: SettingsView = "main") => {
    setSettingsView(view);
    setSettingsOpen(true);
  }, []);

  const onWizardComplete = useCallback(
    async (created: Plan, body: WizardBody) => {
      // Rebuilding over an existing plan: archive the outgoing one first so
      // history/insight survives (workout history is separate and untouched).
      if (plan) await archivePlan(plan);
      const res = await commitNewPlan(created, { body, currentProfile: profile });
      // Coach continuity: the plan swap is a new episode on an unbroken
      // history — record it so the coach references the archive, not confusion.
      // Never throws: a failed write is reported to the user inside remember().
      void recordPlanStarted(res.plan, plan);
      setPlan(res.plan);
      setProfile(res.profile);
      setPlanWizardOpen(false);
      setPlanEditor(null);
      setPlanBannerDismissed(false);
      setNonce((n) => n + 1);
      setTab("home");
    },
    [plan, profile],
  );

  // Edit-mode, non-forking change: modify the current plan in place (keep id,
  // program, group progress). No archive, no recordPlanStarted — this is the
  // same plan, not a new episode.
  const onModifyPlan = useCallback(
    async (body: WizardBody, patch: { endDate?: string; durationWeeks?: number }) => {
      if (!plan) return;
      const res = await modifyPlanInPlace(plan, body, patch, { currentProfile: profile });
      setPlan(res.plan);
      if (res.profile) setProfile(res.profile);
      setPlanWizardOpen(false);
      setPlanEditor(null);
      setNonce((n) => n + 1);
      setTab("plan");
    },
    [plan, profile],
  );

  /** Open the wizard to build a brand-new plan (no plan to edit). */
  const startNewPlan = useCallback(() => {
    setSettingsOpen(false);
    setPlanEditor(null);
    setPlanWizardOpen(true);
  }, []);

  /** Open the wizard in edit mode, prefilled from the active plan. */
  const editPlan = useCallback(() => {
    if (!plan) return;
    setSettingsOpen(false);
    setPlanEditor(plan);
    setPlanWizardOpen(true);
  }, [plan]);

  // The plan wizard, opened from the banner, owns the screen while active but is
  // fully dismissible (no longer a mandatory first-run gate).
  if (ready && planWizardOpen) {
    // The notice sits at the same child index as in the main return below (the
    // null stands in for the header), so React keeps its state when the wizard
    // closes; a failed plan/profile save is then still shown.
    return (
      <div className="app">
        {null}
        <SaveFailedNotice />
        <main className="screen">
          <WizardScreen
            onComplete={onWizardComplete}
            onModify={onModifyPlan}
            editPlan={planEditor}
            onClose={() => {
              setPlanWizardOpen(false);
              setPlanEditor(null);
            }}
            units={units}
            profile={profile}
          />
        </main>
      </div>
    );
  }

  // The safety gate's plan prescribes no workouts, so the Workouts tab goes.
  const loggingOnly = plan?.mode === "logging_only";

  const planBanner =
    ready && !plan && !planBannerDismissed ? (
      <PlanBanner onOpen={() => setPlanWizardOpen(true)} onDismiss={() => setPlanBannerDismissed(true)} />
    ) : null;

  // Evening-only, banner-only (no notifications by design): nudge a coach
  // check-in until today has one.
  const checkinBanner =
    ready && !checkinDone && !checkinDismissed && evening ? (
      <DayCheckinBanner onOpen={() => setCheckinOpen(true)} onDismiss={() => setCheckinDismissed(true)} />
    ) : null;

  const banners =
    planBanner || checkinBanner ? (
      <>
        {planBanner}
        {checkinBanner}
      </>
    ) : null;

  const title = tab === "plan" ? "Plan" : tab === "workouts" ? "Workouts" : tab === "coach" ? "Coach" : "Conjure Fitness";

  return (
    <div className="app">
      <AppHeader title={title} onSettings={() => openSettings("main")} />
      <SaveFailedNotice />

      <main className="screen">
        {!ready ? (
          <div className="center-fill">
            <div className="spinner" />
          </div>
        ) : tab === "plan" ? (
          <PlanScreen
            nonce={nonce}
            plan={plan}
            units={units}
            onPlanChange={setPlan}
            onAskCoach={openCoach}
            onEditPlan={editPlan}
            onEditWorkouts={() => openSettings("program")}
            onStartPlan={startNewPlan}
          />
        ) : tab === "workouts" && !loggingOnly ? (
          <WorkoutsScreen
            units={units}
            plan={plan}
            onPlanChange={setPlan}
            date={date}
            nonce={nonce}
            onMutated={() => setNonce((n) => n + 1)}
          />
        ) : tab === "coach" ? (
          <CoachScreen onPlanChange={setPlan} initialPrompt={coachInitialPrompt} />
        ) : (
          <HomeScreen
            plan={plan}
            units={units}
            nonce={nonce}
            banner={banners}
            onOpenWorkouts={() => setTab("workouts")}
            onOpenPlan={() => setTab("plan")}
            onAskCoach={openCoach}
          />
        )}
      </main>

      <nav className="tabbar">
        {/* Desktop only (hidden below the rail breakpoint): with the tab bar
            turned into a left rail, the rail is where the app's identity
            belongs — otherwise the nav starts flush against the header. */}
        <div className="rail-brand" aria-hidden>
          <span className="brand-mark">
            <WorkoutsIcon />
          </span>
          <span className="rail-brand-name">Conjure Fitness</span>
        </div>
        <TabButton label="Home" Icon={HomeIcon} active={tab === "home"} onClick={() => setTab("home")} />
        <TabButton label="Plan" Icon={TrendsIcon} active={tab === "plan"} onClick={() => setTab("plan")} />
        <TabButton label="Coach" Icon={CoachIcon} active={tab === "coach"} onClick={() => openCoach()} />
        {!loggingOnly && (
          <TabButton label="Workouts" Icon={WorkoutsIcon} active={tab === "workouts"} onClick={() => setTab("workouts")} />
        )}
      </nav>

      <div className="app-version">v{__APP_VERSION__}</div>

      {checkinOpen && (
        <DayCheckinSheet
          date={today}
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
          profile={profile}
          plan={plan}
          initialView={settingsView}
          onClose={() => setSettingsOpen(false)}
          onProfileChange={setProfile}
          onPlanChange={setPlan}
          onDataCleared={onDataCleared}
          pendingUnits={pendingUnits}
          onPendingUnits={setPendingUnits}
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
