# Conjure Health — Internals

> **Assessment date: 2026-08-21.** Written against `origin/main` @ `eacf65f`
> ("Let the user call it, not us"), `package.json` version **1.23.1**.
> The app is actively being worked on. Anything below marked
> **IN PROGRESS** / **NOT SHIPPED** / **UNWIRED** was verified against the code
> on that date — re-check before trusting it.

## How to port this into the in-app "ConjureOS Internals" doc

Every `##` heading below is one entry in the `SECTIONS` array
(`supabase/functions/admin-docs/docs-content.ts`), in this order. The `id` is
stable — do not renumber or rename when re-porting.

| # | `id` | `title` |
|---|------|---------|
| 1 | `health-overview` | Conjure Health at a glance |
| 2 | `health-architecture` | Architecture: three layers |
| 3 | `health-build-tooling` | Build tooling (still Vite) |
| 4 | `health-screens` | Screens and navigation |
| 5 | `health-v2-scope` | The v2 scope: what shipped, what didn't |
| 6 | `health-data-model` | Data model |
| 7 | `health-persistence-split` | Persistence: the Mock/Supabase split |
| 8 | `health-food-lookup-chain` | Food lookup chain and the local cache |
| 9 | `health-backend-foods-db` | Backend: the `health-foods-db` edge function |
| 10 | `health-migration-100-barcode` | Migration 100: the barcode uniqueness fix |
| 11 | `health-ai-usage` | Every `ai.complete()` call, tier and cost |
| 12 | `health-cross-app` | Cross-app: actions provided and needs consumed |
| 13 | `health-mobile-healthkit` | Mobile: the HealthKit path |
| 14 | `health-safety-layers` | The five safety layers (and which are live) |
| 15 | `health-coach-pause-flag` | The coach/workout pause flag |
| 16 | `health-build-publish` | Build, version and publish |
| 17 | `health-decision-rename` | Decision: the rename that isn't a rename |
| 18 | `health-decision-v2-scoping` | Decision: scoping v2 (2026-06-24) |
| 19 | `health-decision-vfs-not-supabase` | Decision: v2 data lives in VFS, not Supabase |
| 20 | `health-decisions-other` | Other recorded decisions |
| 21 | `health-status` | Current status (dated) |

---

## health-overview — Conjure Health at a glance

**Read this first, because the repo name lies.**

- The product is called **Conjure Health**.
- The repository is `Jonny-B/conjureos-fitness`.
- The App Store slug is `fitness`.
- The npm package name is `conjureos-fitness`.
- The display name lives in exactly one place:
  `package.json` → `conjureos.displayName: "Conjure Health"`, plus the
  `<title>` in `index.html:6`.

That mismatch is deliberate (see `health-decision-rename`). If you go looking
for a repo called "conjureos-health", you will not find one.

**What it is today (1.23.1):** a nutrition and weight-loss tracker, published as
a ConjureOS anchor app. Log food by search / barcode / photo / plain language,
see calories and macros against a daily target, weigh in, and follow a simple
food-focused plan. Apple Health / wearable workout calories are read in and added
back to the day's budget — **but only on a mobile build compiled with
`EXPO_PUBLIC_CONJUREOS_HEALTH=1`, which today means TestFlight/prod only**; see
`health-mobile-healthkit`.

**What it is *not* today:** a workout app. The AI coach, the adaptive workout
program, the built-in workout library and the evening check-in were all switched
off on 2026-08-14 behind a single build-time flag. The code is all still there
and still tested — see `health-coach-pause-flag`.

Icon: `fa:apple-whole`. Permissions declared in `package.json`:
`ai.complete`, `vfs.read`, `vfs.write`, `actions.read`, `actions.write`,
`native.location`, `native.health`.

> `native.location` is currently unreachable from the UI: it is only used by the
> cardio distance tracker (`src/bridge/location.ts`, `src/features/cardio/tracker.ts`),
> which sits inside the workout runner, which the pause flag hides. It is still
> declared, so it will show on the permission list.

---

## health-architecture — Architecture: three layers

`README.md` describes three layers and the code actually matches. Everything
above the data layer is backend-agnostic.

**1. `src/bridge/` — thin wrappers over the ConjureOS host surface.** Each one
feature-detects the host and degrades to a mock or an empty result, so
`npm run dev` walks every flow outside the OS.

| File | Wraps | Behaviour with no host |
|---|---|---|
| `src/bridge/ai.ts` | `window.__conjureos.ai.complete` | `mockComplete()` returns a canned meal-parse JSON (`ai.ts:109`) |
| `src/bridge/vfs.ts` | `window.__vfs` | in-memory `Map`, lost on reload (`vfs.ts:34`) |
| `src/bridge/host.ts` | `window.__conjureos.auth` + `.identity` | every call resolves `null` / `{signedIn:false}` |
| `src/bridge/actions.ts` | `window.__conjureos.actions.register` | `registerActions()` no-ops (`actions.ts:233`) |
| `src/bridge/recipeBridge.ts` | `actions.discover` / `.invoke` / `.list` | bundled mock recipes |
| `src/bridge/health.ts` | `window.__conjureos.native.health` | returns `[]` / `0` |
| `src/bridge/location.ts` | `window.__conjureos.native.location` | falls back to `navigator.geolocation` |

`extractJson()` (`src/bridge/ai.ts:95`) is the single shared "pull the JSON out
of a model reply" helper — fenced block, then the widest `{…}` span, then the
trimmed input. It returns a *candidate string*, never a parsed value; every
caller still wraps `JSON.parse` in try/catch and validates the shape.

**2. `src/data/` — one `Repository` interface, two implementations.**
`src/data/repository.ts:50` defines the contract. `getRepository()`
(`repository.ts:147`) is an idempotent lazy singleton that picks the backend.
Nothing above this line knows which one is live. See `health-persistence-split`.

**3. `src/features/` + `src/screens/` — pure logic, then React UI.**
Diary math (`features/diary.ts`), Mifflin-St Jeor goals (`features/goals.ts`),
food providers (`features/foods/*`), plan generation and adaptation
(`features/plan/*`), the coach (`features/coach/*`), safety
(`features/safety/*`), exercise-calorie aggregation (`features/exercise.ts`).
Screens read state from `App.tsx`, not from the repository directly, wherever
practical.

**Shared state and invalidation.** `src/App.tsx` is the single source of
navigation and shared state: active tab, selected date, cached
`profile` / `goals` / `plan`. After any write, `setNonce(n => n + 1)` is the
app-wide "re-read" signal (`App.tsx:107`). Note the caveat documented in the
`onDataCleared` JSDoc (`App.tsx:96-100`; the callback itself is at `:101`): the plan lives in `App` state, so a nonce bump alone can't make a
cleared plan disappear — that's why `onDataCleared` re-reads plan/profile/goals
explicitly.

`registerActions()` is fired once at startup and its failure is swallowed —
cross-app integration is explicitly non-fatal (`App.tsx:121`).

---

## health-build-tooling — Build tooling (still Vite)

**Verified 2026-08-21: Conjure Health is still on Vite. It has NOT migrated to
`@conjureos/pack`.**

- `vite.config.ts` — React plugin, `target: es2022`, `minify: false`
  (deliberate: ConjureOS lets users and the in-OS AI read installed app source,
  so the published build must stay readable — `vite.config.ts:29-31`).
- Two outputs from the same source:
  - `npm run build` → `dist/index.html` + separate JS/CSS.
  - `npm run build:inline` → `dist/index.html` with everything inlined
    (`vite-plugin-singlefile`). **This is the one CI publishes.**
- `tsconfig.json` is strict, plus `noUnusedLocals`, `noUnusedParameters`,
  `noUncheckedIndexedAccess`.
- Tests: `vitest run`. Dev server: `vite` on port 5181.

There is **no `conj-pack`, no `dist/recipes.html`-style store-bundle gate, and no
`src/version.ts`**. Do not copy the Recipes app's CLAUDE.md rules here; they are
a different pipeline.

**Two stale claims to be aware of:**

1. `README.md` says "`npm run typecheck` and `npm run build` are the CI gates."
   That is not true today: `.github/workflows/` contains exactly one file,
   `publish-store.yml`, and it only builds — there is no PR/push CI that runs
   typecheck or tests. Those gates are local-only.
2. ConjureOS `STATUS.md:34` describes the CI build path as `@bundle`
   (`source-path` mode) — but the **same sentence already exempts this app**
   ("Recipes on `@conjureos/pack`; *Fitness/Health + Finance still on Vite for
   now*"), so it is not wrong about the build path. Conjure Health's workflow
   passes `html-path: dist/index.html`, the prebuilt Vite single-file; the
   shared publish action supports both modes (`source-path` at
   `ConjureOS/.github/actions/publish-anchor-app/action.yml:23`, `html-path` at
   `:30`). What `STATUS.md:34` *is* stale about is the product description —
   see `health-status`.

Re-Vite-ing (moving to `@conjureos/pack`) was explicitly deferred and is *not* a
v2 prerequisite (DECISIONS 2026-06-24; PHASE_12_DESIGN 12b "Build path").

---

## health-screens — Screens and navigation

`App.tsx:37` declares the tab union:
`"diary" | "meal" | "add" | "plan" | "workouts" | "coach"`.

**Visible bottom tab bar today (flag OFF): Diary · Add · Plan.** The Workouts
tab button is rendered only when `!loggingOnly && COACH_AND_WORKOUTS_ENABLED`
(`App.tsx:384`), so it is currently absent. The Coach tab has never had a tab
button — it is reached from the Plan tab's launcher, which is also flagged off.

| Surface | File | State |
|---|---|---|
| **Diary** (home) | `src/screens/DiaryScreen.tsx` | Live. Calorie ring + macro bars, weight card, plan card, per-meal rings, day nav. Exercise row opens the exercise view. |
| **Meal detail** | `src/screens/MealDetailScreen.tsx` | Live. The day's entries for one meal; edit/move/delete via `EntryEditModal`; three entry CTAs (Scan / Search / AI). |
| **Add food** | `src/screens/AddFoodScreen.tsx` (1073 lines, the biggest screen) | Live. Four modes: Scan (barcode), Search (OFF + USDA + "From your apps" recipes), AI (photo-scan a meal, or describe in text), plus recent-saved re-logging. Includes the "Looks wrong?" correction entry point. |
| **Plan** | `src/screens/PlanScreen.tsx` | Live, reduced. Plan header + edit, daily-targets override, weekly movement goal, Trends (weight sparkline + BMI + weigh-in). Program/benchmark section and coach launcher are behind the flag (`PlanScreen.tsx:96`, `:119`). |
| **Plan wizard** | `src/screens/WizardScreen.tsx` | Live. Steps: `disclaimer → mode → safety → inputs → review` (`WizardScreen.tsx:38`). With the flag off, the mode picker is hidden and mode is forced `eat_better` (`WizardScreen.tsx:128`). It is also the plan *editor* (`editPlan` prop). |
| **Exercise** | `src/screens/WorkoutsScreen.tsx` with `exerciseOnly` | Live in reduced form (`WorkoutsScreen.tsx:51`). Only "Completed today" — wearable + in-app workouts, editable kcal, per-row remove/restore. |
| **Workouts library + runner** | `WorkoutsScreen`, `WorkoutRunner`, `WorkoutOverview`, `CardioPlayer`, `WorkoutSummary`, `CoachReflect` | **Hidden by the flag.** Code intact and tested. |
| **Coach chat** | `src/screens/CoachScreen.tsx` | **Hidden by the flag** (`App.tsx:373`). |
| **Evening check-in** | `src/components/DayCheckin.tsx` | **Hidden by the flag** (`App.tsx:273`, `:391`). Banner-only by design — no notifications. |
| **Settings (cog)** | `src/screens/SettingsSheet.tsx` | Live for units + "Reset health data" only — deliberately *not* a plan editor any more (`SettingsSheet.tsx:14-21`). The program-editor sub-view it still hosts is **unreachable with the flag off**: it renders only when `initialView === "program" && plan?.program` (`SettingsSheet.tsx:46`), `settingsView` is set from the single `openSettings(view)` call (`App.tsx:169`), and the only `"program"` caller is `onEditWorkouts` (`App.tsx:360`) — wired to buttons inside `PlanScreen.tsx:347` / `:418`, both gated on `showProgram` (`PlanScreen.tsx:96`) or on `plan?.program`, which the flag-forced `eat_better` mode never produces. |

**The plan banner, not a gate.** Early v2 made the wizard a full-screen first-run
gate. It is now a dismissible `PlanBanner` above the Today tracker
(`App.tsx:265`); the app is fully usable for logging with no plan at all.

**Plan edit forks or modifies.** `decidePlanEdit` (in
`features/plan/planService.ts`) decides whether a wizard edit forks a brand-new
plan (`onWizardComplete` → archive the old one → `commitNewPlan`) or modifies
the current one in place (`onModifyPlan` → `modifyPlanInPlace`, keeps id,
program and group progress). See `App.tsx:183` and `App.tsx:208`.

---

## health-v2-scope — The v2 scope: what shipped, what didn't

v2 was scoped on 2026-06-24 as three things on top of the shipped v1 calorie
tracker: **a plan wizard, a daily check-off home, and an AI workout coach.**
Here is the honest state of each as of 2026-08-21.

### 1. Plan wizard — SHIPPED, and still the main v2 surface

`src/screens/WizardScreen.tsx` (784 lines). Collects mode, a short safety
intake, body stats, dates and a free-text goal, then calls
`createPlan()` (`features/plan/generate.ts`).

Generation is **two AI calls, not one** (`generate.ts:28`):

- `generateCore` — goals + summary + calorie target, `maxTokens: 900`, tier
  `capable`. Small enough that it cannot truncate.
- `generateProgram` — the full workout program, `maxTokens: 4096`, tier
  `capable`, best-effort. Its failure attaches a known-safe starter program
  rather than sinking the whole plan.

The split exists because a single combined call truncated mid-JSON and threw
away the *entire* plan (goals and all) as "couldn't be understood", forcing the
fallback template every time. The app also computes the daily calorie target
locally via Mifflin-St Jeor and injects it (`PlanInput.calorieTarget`,
`features/plan/model.ts:46`) so a missing AI number can't force the fallback.

With the coach paused, the program half of generation is still *run* but the
result is never displayed (the wizard forces `eat_better`, and
`modeHasWorkouts("eat_better") === false`).

### 2. Daily check-off home — **NOT SHIPPED as designed**

This is the biggest gap between the design docs and the code, and it is easy to
get wrong.

- The **data model exists**: `DailyCheckoff` (`src/types.ts:529`) carries
  `goalsCompleted: string[]`, and `Repository.markCheckoff(goalId, date, done)`
  is declared (`repository.ts:108`) and implemented in `MockRepository`
  (`mockRepository.ts:299`).
- **Nothing calls `markCheckoff`.** Verified by grep on 2026-08-21: the only
  hits are the interface declaration, the mock implementation, and the Supabase
  stub. There is no UI anywhere that ticks a plan goal off for the day.
- `goalsCompleted` is *read* in exactly one place —
  `src/components/DayCheckin.tsx:73` — to compute "missed goals" for the evening
  coach check-in, which is itself flagged off. Since nothing ever writes it, it
  is always empty, so every plan goal reads as missed.
- The home tab became the Diary with a plan summary card
  (`src/components/CoachPlanCard.tsx`), not a check-off list.

**Do not document the check-off home as working.** The `DailyCheckoff` record
*is* live, but only for the fields other features write to it: `checkin`,
`excludedWearableKeys`, `wearableKcalOverrides` (see `features/exercise.ts`).

### 3. AI workout coach — BUILT, then PAUSED

Fully built between 1.4.0 and 1.20.1: `src/features/coach/` (context snapshot,
`coach.json` memory, question bank, chat, check-in evaluation, ask-first plan
proposals) plus `CoachScreen`, `CoachReflect`, `DayCheckin`. Then switched off
on 2026-08-14. See `health-coach-pause-flag`.

The "Tell coach" **mid-session reprompt bar** from the original P4 scope was
never built: `WorkoutSession.reprompts` is written as `[]` at every construction
site and never appended to.

### The six phase issues

`Jonny-B/conjureos-fitness` #57–#62, opened 2026-06-24:

| Issue | Scope | Estimate | Actual state 2026-08-21 |
|---|---|---|---|
| P0 #57 | Domain model + Repository extension (Mock impl) | ~5–6 hr | **Done** — v1→v2 store migration (`mockRepository.ts:migrate`), Supabase stubs throw `PLAN_REQUIRES_V2_BACKEND` |
| P1 #58 | Safety static assets | ~4 hr | **Partly done** — see `health-safety-layers`; layer 3 is unwired |
| P2 #59 | Wizard + plan-gen + validator + fallback | ~10–12 hr | **Done**, and heavily iterated since |
| P3 #60 | Home screen + daily check-off | ~6–8 hr | **Not done as scoped** — see above |
| P4 #61 | AI coach + Tell-coach bar + symptom classifier + reprompt validator | ~12–14 hr | Coach **built then paused**; Tell-coach bar and reprompt validator **never built**; symptom classifier written but **unwired** |
| P5 #62 | Settings + `notify` permission + disclaimer + ToS link + publish | ~5–6 hr | Settings + disclaimer done; **`notify` is not in the manifest permission list** and `notify` appears nowhere in `src/` |

> **Provenance note.** The recorded decision
> (`ConjureOS/DECISIONS_ARCHIVE.md:72`) words P4 as *"AI workout coach +
> Tell-coach bar"* and P5 as *"Settings + `notify` permission + disclaimer +
> publish"*. The extra items above — "+ symptom classifier + reprompt
> validator" on P4 and "+ ToS link" on P5 — come from `PHASE_12_DESIGN.md` §12b's
> build-phase list, not from the decision entry. The GitHub issues themselves
> (#57–#62) were **not readable when this doc was written**, so treat issue
> titles and states as unverified. Every issue number, and
> `ConjureOS#553` / `ConjureOS#573` / `conjureos-mobile#2` / `conjureos-mobile#7`
> elsewhere in this doc, is reported as of **2026-08-21** and was not confirmed
> against GitHub.

Total estimate at scoping: **~42–50 productive hours, ~5–6 weeks of evenings.**
Actual elapsed: 2026-06-24 → 2026-08-19, ~60 versions, and the shape changed
substantially along the way.

### Explicitly out of v2 (from the 2026-06-24 decision)

Cloud sync of plans, photo-logging additions, voice input, mode switching
mid-plan, plan history, trends additions, streaks/badges/nags, wearables,
hydration/sleep/mood, PR detection, saved meal templates, cross-app deep-links
*into* Health from other anchors, data export/import, sharing.

Note that several of these were later built anyway — **wearables** (Apple Health
exercise calories, 1.14.0) and **plan history** (`plan-archive.json`) both
shipped despite being listed as out-of-scope. The out-list is a record of intent
at scoping time, not a constraint that held.

---

## health-data-model — Data model

All domain types live in `src/types.ts` (656 lines). The load-bearing ones:

**`Profile`** — sex, age, `heightCm`, `weightKg`, `activityLevel`, `direction`
(lose/maintain/gain), `goalWeightKg?`, `units` ("metric" | "imperial").
**Storage is always metric**; `units` only affects display and the text the plan
generator writes (`features/plan/model.ts:50`).

**`Goals`** — `{ calories, protein, carbs, fat }`. The standalone daily target,
used when there's no plan.

**`FoodItem`** — `id`, `source` (`custom` | `recipe` | `conjure_health` | OFF /
USDA), `name`, `brand?`, `barcode?`, `perServing: Macros`, `servingSize`,
`servingGrams?`, `micros?` (fibre, sugars, fats, minerals, vitamins, alcohol,
caffeine), `provenance?` (`sourceTag`, `aiConfidence`, `isCanonical`, `license`,
`attributionText`). `provenance.sourceTag === "ai_estimate"` is what makes the
diary show the "AI estimate" badge (`components/AiEstimateBadge.tsx`).

**`DiaryEntry`** — `id`, `date` (YYYY-MM-DD), `meal`, `food` (a *snapshot*, not
a reference), `quantity`, `loggedAt`. Snapshotting the food is why editing a
logged entry can change its macros without touching any catalog.

**`WeightEntry`** — `{ date, weightKg }`, one canonical row per day.

**`Plan`** (`types.ts:488`) — `id`, `mode`, `durationWeeks` (1–4), `startDate`,
`endDate`, `goals: PlanGoal[]`, `targets?: PlanTargets`, `safety: SafetyIntake`,
`liability: LiabilityAck`, `createdAt`, `goalText?`, `weeklyExerciseDays?`,
`program?: WorkoutProgram`. Note how many fields are *additive optionals* with
a documented "absent on pre-X plans" comment — old plans are never migrated,
they are read defensively.

- `PlanMode` = `eat_better` | `get_fit` | `both` | `logging_only`.
  `logging_only` is what the safety intake gate forces.
- `Plan.targets` is the calorie + macro target the diary rings read via
  `targetsToGoals(plan, goals)` (`App.tsx:144`), falling back to the stored
  `Goals` when there is no plan.
- `weeklyExerciseDays` counts **days, not sessions** (`types.ts:510`), because a
  wearable workout and a manual entry both land for the same effort and
  `features/exercise.ts` adds them together on purpose.

**`DailyCheckoff`** (`types.ts:529`) — `date`, `goalsCompleted[]` (see
`health-v2-scope`: never written), `weightKg?`, `checkin?`,
`excludedWearableKeys?`, `wearableKcalOverrides?`.

**`WorkoutSession`** — `id`, `date`, `planned`, `actual`, `reprompts` (always
`[]`), `completedAt`, `caloriesBurned?`, `source?`, `workoutName?`, `cardio?`,
`benchmarkIds?`.

**`WorkoutProgram`** — `workouts: ProgramWorkout[]`, `benchmarks: Benchmark[]`
(1–4), `analysisCursor?`. Workouts are organised into numbered **groups**, not
weeks (`features/plan/groups.ts:1`) — deliberately, so there are no dates to
fall behind on. Group 1 of a cycle is an evaluation group; completing every
workout in a group unlocks the next.

**`SafetyIntake`** — `ageBand`, `pregnant`, `cardiacFlag`, `injuries: string[]`.
**`LiabilityAck`** — `acknowledged`, `acceptedAt`, `appVersion?`; stored on the
plan, which is the single canonical home for the disclaimer audit record.

---

## health-persistence-split — Persistence: the Mock/Supabase split

**This is the section a junior developer is most likely to "fix". Don't.**

### The two implementations are deliberately unequal

`src/data/repository.ts:50` declares one interface with two groups of methods:

- **v1 surface** — profile, goals, diary entries, weights, plus the history
  clears. Implemented by **both** `MockRepository` and `SupabaseRepository`.
- **v2 surface** — `getPlan` / `savePlan` / `clearPlan`, `getDayLog` /
  `saveDayLog` / `markCheckoff`, `listWorkoutSessions` / `saveWorkoutSession` /
  `removeWorkoutSession`, and `clearWorkoutHistory`. Implemented **only** by
  `MockRepository`. Every one of these throws
  `new Error(PLAN_REQUIRES_V2_BACKEND)` from `SupabaseRepository`:
  `clearWorkoutHistory` at `supabaseRepository.ts:182`, and the nine
  plan / day-log / session stubs at `:191-216` under the section comment
  `// ── v2: VFS-only today; no backend rows yet (DECISIONS 2026-06-24). ──`
  at `:187`.

`PLAN_REQUIRES_V2_BACKEND` is exported from `repository.ts:41` precisely so
callers can catch it and route around it rather than surfacing it to the user.

**Why:** owner call, 2026-06-24 — "as part of the user's storage". Plan,
check-off and workout-session data persists as **VFS app data**, so v2 needed no
new Supabase tables, no RLS policies and no migration; Phase 9 platform sync
backs up the VFS files for free. See `health-decision-vfs-not-supabase` for the
full reasoning.

### `MockRepository` is not a mock — it is the default backend

Despite the name, `src/data/mockRepository.ts` is what almost every user is
actually running on. It holds one JSON document in memory and persists it two
ways (`mockRepository.ts:1`):

1. **`localStorage` key `conjure-fitness:store:v2` — AUTHORITATIVE.** Each app
   runs on its own origin (`<slug>.conjureos.app` desktop,
   `<slug>.mobile.conjureos.app` mobile), so this is app-private, survives an
   iframe/WebView reload, **and is not part of ConjureOS cloud file-sync.**
2. **VFS `store.json` — best-effort mirror.** Written on every change so
   `npm run dev` reloads work and so a brand-new device can seed itself from
   whatever last synced. It is **never** read back as authoritative once a
   device-local copy exists (`mockRepository.ts:169`).

The reason for the split is a real bug that was shipped and fixed: the store is
one JSON document and the repository flushes the *whole* document on every
write. When that document is a single cloud-synced file edited from multiple
live surfaces, whole-file last-write-wins means the last blind flusher clobbers
every field — so a units change on one device got reverted the moment another
(stale) surface wrote anything. Pinning truth to un-synced `localStorage`
removes that failure class. **The accepted cost: cross-device propagation is
seed-on-first-run, not live.** That is a deliberate, data-loss-averse trade.

`migrate()` (`mockRepository.ts:131`) normalises whatever is on disk: a `v: 2`
document passes through, a `v: 1` document keeps its profile/goals/diary/weights
and synthesises empty v2 slices, anything else resets to `EMPTY`.

### Which backend is selected, and the reachability probe

`buildRepository()` (`repository.ts:177`). Supabase is selected only when **all
three** hold:

1. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` were baked in at build time,
2. the host exposes `auth.getAccessToken` (`isHostAuthAvailable()`), and
3. that bridge actually yields a token.

Even then, the selector constructs `SupabaseRepository`, calls `init()`, and
then performs a **reachability probe** — a real `getProfile()` read. On *any*
throw (unexposed schema, RLS rejection, network failure) it logs a dev warning
and falls through to `MockRepository`. The guarantee is explicit: a broken or
unreachable Supabase backend can never become the active repository, because if
it did, `App.tsx`'s first `getProfile()` would throw and hang the app on a
spinner.

### `SupabaseRepository` in practice

`src/data/supabaseRepository.ts` talks to a `fitness` Postgres schema via a
hand-rolled PostgREST client (`src/data/supabaseClient.ts`) — deliberately not
`supabase-js`, to keep the dependency out of the bundle. Non-public schema
access uses `Accept-Profile` / `Content-Profile: fitness` headers. Identity is
SSO: the bearer token is the *host* user's session token, fetched fresh per
request via a `TokenProvider` so the host owns refresh. The client never sends
or trusts a user id — every table defaults `user_id` to `auth.uid()` and RLS
scopes the rows.

Tables it expects: `profiles`, `goals`, `diary_entries`, `weights`. The
migrations for them live in a **separate private repo** (staged under `_backend/`
locally, gitignored). As of 2026-08-21 there is **no live fitness Supabase
backend** — no `profiles`/`goals` tables exist in the shared dev project, so in
practice every user is on the VFS/`localStorage` path. This was confirmed during
the 1.11.2 investigation and recorded in the repo's `STATUS.md`.

### Consequence you will hit

`clearHistory("workouts")` calls `repo.clearWorkoutHistory()`, which throws on
the Supabase path. `src/features/resetData.ts:55` swallows it — every clear is
`.catch(() => {})` and best-effort by design, so one unavailable store can never
leave a "clear all" half-applied.

---

## health-food-lookup-chain — Food lookup chain and the local cache

`src/features/foods/foodSearch.ts` is the single entry point.

**Text search** (`searchFoods`, `foodSearch.ts:157`) fans out to Open Food Facts
(branded) and USDA FoodData Central (whole foods) **only** — in parallel, each
provider independently timed out, results painting progressively via `onPartial`
because a slow or 503-ing OFF search endpoint used to wedge the whole search.
> ⚠️ **Every published build runs USDA on the shared `DEMO_KEY`.**
> `usda.ts:17` is `const KEY = import.meta.env.VITE_USDA_API_KEY ?? "DEMO_KEY";`,
> and `.github/workflows/publish-store.yml` bakes **only** the two Supabase vars
> (`:52-53` dev, `:59-60` prod) — `VITE_USDA_API_KEY` is set in neither job. The
> file's own header (`usda.ts:5-6`) states the consequence: *"Free API; ships
> with DEMO_KEY (30 req/hr per IP). Set VITE_USDA_API_KEY for the 1000/hr signup
> limit."* That quota is **shared globally** across every ConjureOS user behind
> a given IP. On 429 the provider promise is swallowed by
> `.catch(() => {})` (`foodSearch.ts:187`) and USDA simply contributes nothing
> to the merge — **no error, no message, just fewer results**, and since USDA is
> the front-loaded 0.7-share half of the merge, that is the *whole-foods* half
> of search quietly disappearing. Filed as **conjureos-fitness#70**
> (2026-08-21). Adding `VITE_USDA_API_KEY` to both build jobs is the single
> cheapest fix in the food chain. See also the stale comment noted under
> `health-status` → Documentation health: `usda.ts:18-19` claims "the UI notes
> the degraded search", and it does not.

Results are biased US-first (`mergeUsFirst`, `foodSearch.ts:137`): USDA is pulled
at a higher share (0.7 × limit vs 0.5) and front-loaded 2:1, and OFF adds a
`cc=us` + United-States country filter.

> **Gap, verified 2026-08-21:** text search does **not** query the community food
> DB. `conjureHealthDb.searchText()` exists and the edge function's `search`
> action is live and public, but nothing in `src/` calls it — the community
> catalog is reachable by **barcode only**. The "From your apps" recipe results
> in the Search tab come from `recipeBridge`, not from this function.

**Barcode lookup** (`foodSearch.ts:60`), in order:

1. **Local corrections map** — `cache.corrections[barcode]`, the user's own
   corrected food from the "Looks wrong?" flow. Consulted *first*.
2. **Local cache entries** — including remembered *misses*, so a repeat scan of
   an unknown item doesn't re-roundtrip.
3. **`health-foods-db` edge function** — which itself checks our catalog, then
   Open Food Facts, backfilling on a hit.
4. **Open Food Facts directly** — the fallback for the offline / unconfigured /
   DEMO cases.

Cache file: VFS `food-cache.json`, `v: 2`, shape
`{ v, entries: Record<barcode, FoodItem|null>, corrections?: Record<barcode, FoodItem> }`.

**Why corrections are a separate map (`foodSearch.ts:26`):** a correction pushed
to the community DB lands as a `user_manual` row, and lookups do not serve
un-promoted `user_manual` rows — so the next scan would re-backfill the bad
upstream figures straight over the user's fix. The local corrections map is what
actually makes a fix stick for the person who made it, whatever the server
decides to do with it. `rememberCorrection()` (`foodSearch.ts:121`) is local and
unconditional, and is separate from `contribute()`.

**A pair of very recent changes worth knowing (both 2026-08-19):**

- `1.23.0` added `src/features/foods/plausibility.ts` — an Atwater cross-check
  (4/4/9, 7 for alcohol) that flagged impossible nutrition data, triggered by a
  Lay's barcode returning 10,000 kcal against macros summing to ~544.
- `1.23.1` **removed it again**, along with the automatic `flagFood()` call.
  Reasoning in the commit: judging the data ourselves made the log panel change
  shape depending on whether we happened to spot something, and the checks could
  only catch arithmetic that contradicts itself, never the merely-wrong-but-
  consistent case (which is most of them). "Looks wrong?" is now one plain
  button in one fixed spot under Add, shown for every food. Saving a correction
  submits only the user's own numbers; it no longer files a report against the
  existing row. Reinstating any of it is tracked as **ConjureOS#553**,
  deliberately and separately.

**What "saving" also does, that the UI never asks about.** Every save through
`EditableNutritionPreview` — the AI-label path, the front-of-package path and
the "Looks wrong?" correction path alike (`AddFoodScreen.tsx:385`, `:977`,
`:990`) — **uploads the food to the shared community catalog**, unconditionally,
before the local save resolves (`EditableNutritionPreview.tsx:103`). The row is
stored against the user's id server-side. There is no opt-out and, on desktop,
no consent prompt; the only UI trace is the failure notice. This is the app's
one outbound data path, so it is documented again with its full consent story
under `health-cross-app` → "Health data and App Review"
(conjureos-fitness#71).

The `flag` action still exists server-side; only the client wrapper was removed.

---

## health-backend-foods-db — Backend: the `health-foods-db` edge function

**Lives in the ConjureOS repo, not this one:**
`ConjureOS/supabase/functions/health-foods-db/index.ts` (686 lines), with
migrations `090_health_foods.sql`, `092_health_foods_moderation.sql`, and
`100_health_foods_barcode_full_unique.sql`.

> **On "deployed".** Every claim in this section about what is *live* on the dev
> or prod Supabase project — that the function is deployed, that 090/092/100 are
> applied, and what `verify_jwt` is actually set to — is **asserted from the
> decision log and CI convention, not observed**. CI is the sole applier
> (`supabase-migrate.yml` on `supabase/migrations/**`,
> `supabase-functions.yml` on `supabase/functions/**`) and the decision log
> records these as shipped to both projects, which is good evidence but is not
> the deployed state. Nothing in this environment can query the projects. Treat
> deployment claims here as repo-state plus convention, and check the dashboard
> when it matters — as it does for `verify_jwt` below.

This is a *shared community food catalog*, distinct from the (currently absent)
per-user `fitness` schema. Anchor-app backends live in the ConjureOS repo by
policy — one Supabase project instead of one per anchor app (DECISIONS, the
"Consolidation" entry).

### Tables (migration 090, all in `public`)

**`health_foods`** — the canonical catalog, one row per unique food. ~30 nullable
numeric nutrient columns (macros, fats, sugars, minerals, vitamins, alcohol,
caffeine) following the owner's "liberal nulls" rule. Key non-nutrient columns:

- `barcode text` (nullable — produce and front-of-package snaps have none)
- `source text not null` — CHECK constrained to
  `our_db | off_backfill | usda_backfill | ai_label | ai_front | user_manual`
- `ai_confidence numeric` — CHECK 0..1
- `needs_review boolean` — low-confidence AI parses; filtered out of lookups
- `is_canonical boolean` — trusted rows, surfaced first
- `is_flagged` / `flag_count` / `flag_reason`
- `contributed_by uuid → auth.users`, `display_attribution boolean`
- `license text` — CHECK `odbl-1.0 | public-domain | user-contributed`
- `attribution_text`, `raw_source_data jsonb`

Indexes include a GIN full-text index on `lower(name || ' ' || brand)` plus
partial indexes on `needs_review`, `is_flagged`, `is_canonical`, contributor.
An `updated_at` trigger and an `after update` **history trigger** capture every
UPDATE into `health_foods_history`.

**`health_food_suggestions`** — staging for edits to already-canonical rows.
Prevents barcode squatting: a "fix" to a canonical row lands here for moderation
instead of overwriting the trusted row.

**`health_food_scan_attempts`** — one row per terminal lookup outcome
(`resolved_from` CHECK `our_db|off|usda|ai_label|ai_front|user_manual|miss`),
with `duration_ms`, `app_version`, `platform`, `client_tz`. `scanned_by` is
nullable so it can be scrubbed before any external data-licensing sale — that is
the stated purpose of storing every miss.

**`health_foods_history`** — audit trail, admin-read only.

**`health_foods_public`** — a view that strips contributor identifiers
(`contributed_by` is nulled unless `display_attribution`) and filters
`is_flagged = false`. Granted `select` to `anon, authenticated`.

**RLS + GRANTs** (both, per the ConjureOS rule): catalog SELECT is world-readable
for `anon` and `authenticated`; writes are `service_role` only. Suggestions,
scan attempts and history are scoped to owner + `public.is_admin(auth.uid())`.

### The function's auth model

The function's own header comment (`health-foods-db/index.ts:6-11`) states that
`verify_jwt` is "intentionally OFF at the platform layer" so the function can
serve anon lookups, and self-checks writes instead.

> ⚠️ **The repo does not encode that, and this needs verifying against the
> deployed function.** `ConjureOS/supabase/config.toml` lists exactly seven
> functions with `verify_jwt = false` (`stripe-webhook`, `usda-proxy`,
> `recipes-db`, `mint-app-token`, `cleanup-issue-attachments`, `submit-report`,
> `send-email`) and **`health-foods-db` is not one of them**. The file's own
> header (`config.toml:1-3`) says "Functions not listed here keep CLI defaults
> (`verify_jwt = true`)", and the deploy workflow
> (`ConjureOS/.github/workflows/supabase-functions.yml:77`) runs a plain
> `supabase functions deploy "$fn" --project-ref …` — no `--no-verify-jwt`. The
> directly comparable function, `recipes-db`, uses the *same* minted-token
> pattern and **is** declared at `config.toml:20-26`, with a comment explaining
> that "the gateway JWT check would be wrong here". Filed as **ConjureOS#573**
> (2026-08-21).
>
> **Second-order consequence, if the gateway check is in fact on.** A minted
> ConjureOS ES256 token is *not* a Supabase JWT, so it would be rejected at the
> gateway before `currentUserId()` ever runs — meaning the 1.5.1 "mobile
> contributions now land" fix (see `health-decisions-other`, 2026-07-16) could
> still be dead, **invisibly**, because `conjureHealthDb.call()` fails open and
> returns `null` on any non-`ok` response (`conjureHealthDb.ts:90`). Anon
> *reads* would keep working either way, because the client sends
> `authorization: Bearer <ANON>` (`conjureHealthDb.ts:86`) and the anon key *is*
> a valid Supabase JWT — which is exactly why nothing looks broken.
>
> **What decides it:** whether the client actually presents the minted token or
> the anon key in `Authorization` for a given call, and what the deployed
> function's gateway setting is. `call()` escalates to a minted token only for
> actions in `WRITE_ACTIONS` (`conjureHealthDb.ts:64`) *and* only when
> `getAccessToken()` returned null. Do not treat mobile contributions as working
> until someone checks a real `submit` against the deployed dev function.

Whatever the gateway does, the function self-checks writes. `currentUserId()`
(`health-foods-db/index.ts:125` `currentUserId`) tries two paths in order:

1. **A minted ConjureOS identity token** — ES256, verified locally against
   `mint-app-token`'s JWKS with `issuer` and `audience` checks; `sub` is the user
   id. Tried first because it's a cheap local verify. This is the **mobile**
   path, where the Supabase JWT never enters the WebView.
2. **A raw Supabase user JWT** — the **desktop** path. Rejected unless
   `aud === "authenticated"`, so service-role tokens are refused.

The anon key satisfies neither, so it 401s on any write.

### Actions

`PUBLIC_ACTIONS = { lookup, search, get }`. Everything else requires a verified
user. Per-action in-memory token buckets (`health-foods-db/index.ts:52`
`RATE_BUCKETS` / `:53` `RATE_LIMITS`; the public set is `:49`
`PUBLIC_ACTIONS`), keyed by user id or
IP, resetting on cold start:

| Action | Auth | Rate | What it does |
|---|---|---|---|
| `lookup` | public | 60/min | Barcode chain (below) |
| `search` | public | 30/min | `ilike` on name/brand, `is_flagged = false`, canonical-first ordering, limit 1–50 |
| `get` | public | 60/min | Fetch one row by id |
| `submit` | required | 10/min | User/AI-derived write (below) |
| `logScanAttempt` | required | 60/min | Client-side telemetry row — **see the gap below** |
| `flag` | required | 5/min | Increment `flag_count`; `>= 3` sets `is_flagged` |

**`lookup`** (`health-foods-db/index.ts:170`), three steps:

1. **Our DB.** Deliberately serves only *trusted* rows:
   `is_flagged = false AND needs_review = false AND (is_canonical = true OR source IN (off_backfill, usda_backfill))`.
   Plain user submissions stay invisible until promoted, so one bad contribution
   cannot poison lookups for everyone.
2. **Open Food Facts**, then upsert `ON CONFLICT (barcode)` as `off_backfill`
   with `license: odbl-1.0` and attribution. Two correctness details worth
   preserving:
   - **One basis for the whole product.** OFF carries every nutrient twice,
     `_serving` and `_100g`, and either can be missing per field. Falling back
     field-by-field silently mixes them — a row's calories describing one
     serving while its macros describe 100 g, labelled with OFF's `serving_size`
     string that matches neither. Energy decides the basis; when we fall back to
     100 g we say `"100 g"` rather than borrowing OFF's label.
   - **g→mg conversion.** OFF's `nutriments` masses are in grams, so a "580 mg
     sodium" label is stored as `0.58`. `gToMg()` converts; previously only
     sodium was converted, leaving potassium / cholesterol / calcium / iron /
     caffeine ~1000× too small.
   - A row with **no calories is treated as a miss**, not stored — the client
     would otherwise show a confident 0.
3. **Miss.** Client falls back to an AI photo parse.

> **Telemetry: one harmless gap, one real one. Verified 2026-08-21.**
>
> **The harmless one.** `logScanAttempt` requires auth, and the client never
> escalates to a minted token for it — `WRITE_ACTIONS` is `new Set(["submit"])`
> (`conjureHealthDb.ts:64`). So on mobile (where `getAccessToken()` returns null
> by design) and for any signed-out desktop user it sends `Bearer <ANON>`, is
> refused by the `!PUBLIC_ACTIONS.has(action) && !userId` check
> (`health-foods-db/index.ts:97`, inside `Deno.serve`), and the client swallows
> the failure (`conjureHealthDb.ts:90`). **This costs nothing.** The client's only three
> callers are inside `lookupBarcode` and send exactly
> `resolvedFrom: "our_db"` / `"off"` / `"miss"` (`foodSearch.ts:79`, `:93`,
> `:103`) — the same three outcomes `lookup()` already writes for itself
> server-side (`health-foods-db/index.ts:189` `our_db`, `:218` `off`, `:229`
> `miss`). Fixing the auth escalation would recover duplicate rows and nothing
> else.
>
> **The real one: AI, USDA and text-search outcomes are instrumented nowhere.**
> Not client-side, not server-side. `searchFoods` (`foodSearch.ts:157-192`)
> contains no telemetry call at all, and nothing in `src/` ever passes
> `ai_label`, `ai_front`, `usda` or `user_manual` as `resolvedFrom`, or ever
> populates the `query` field — even though the client SDK's `ScanAttempt` type
> declares all of them (`conjureHealthDb.ts:248-253` `ScanAttempt`) and the server accepts
> them (`health-foods-db/index.ts:455`, the `allowed` array in
> `logScanAttempt`). So the "store
> every unique miss" data-licensing premise (see `health-decisions-other`,
> 2026-06-25) holds for **barcodes only**, permanently, and provider hit-rates
> cannot be compared across the food chain — the thing `logScanAttempt`'s own
> doc comment says it exists to enable — `conjureHealthDb.ts:255-256`, "so
> provider hit-rates can be tuned".

**`submit`** (`health-foods-db/index.ts:352`): input goes through a strict allowlist
(`sanitizeFood`). Numeric fields are **strict, not clamped** — a 999,999-calorie
submission comes back as *no value*, never as a confident reading of the
ceiling, because "saturating a hostile number is how it gets laundered into a
fact". Trust fields (`source`, `ai_confidence`, `needs_review`,
`contributed_by`, `is_canonical`, `license`, `raw_source_data`) are **never**
taken from input; the server sets them. `needs_review` is set when the source is
`ai_*` and confidence < 0.4. If the barcode already matches a **canonical** row,
the write is routed to `health_food_suggestions` and returns `202` with
`accepted_as: "suggestion"` instead of overwriting.

### Moderation

Hands-off, via a weekly `pg_cron` sweep (migration 092 +
`health-foods-moderation-sweep`): flags high-flag-rate contributors (≥3 flagged
in 7d **and** ≥30%) and velocity spikes (≥100 submits/24h), then emails a digest
via the existing Resend wrapper. Quiet weeks send nothing.

**Known pending manual step:** the `conjure_project_url` Vault secret must be set
once per project (dev and prod) or the cron no-ops. Everything else works
without it. Tracked in ConjureOS `OPEN_QUESTIONS.md`.

### Client SDK

`src/features/foods/conjureHealthDb.ts`. Fails **open** — every call returns
`null` on transport error so the lookup chain advances instead of blocking the
user (`conjureHealthDb.ts:3`). `FN_URL` is built from the `VITE_SUPABASE_URL`
baked at build time; in a build without it, every call short-circuits to `null`
and the app behaves as a standalone. `WRITE_ACTIONS = { "submit" }` is the set
that escalates from `getAccessToken()` to `getIdentityToken()`.

---

## health-migration-100-barcode — Migration 100: the barcode uniqueness fix

File: `ConjureOS/supabase/migrations/100_health_foods_barcode_full_unique.sql`.
Small file, important lesson.

```sql
drop index if exists public.health_foods_barcode_uniq_idx;

create unique index if not exists health_foods_barcode_uniq_idx
  on public.health_foods (barcode);
```

**The bug.** Migration 090 created the barcode unique index as a **partial**
index:

```sql
create unique index ... on public.health_foods (barcode) where barcode is not null;
```

Both write paths in the edge function upsert with `ON CONFLICT (barcode)` —
`lookup()`'s Open Food Facts backfill and `submit()`'s user/AI rows. **Postgres
cannot use a partial index for `ON CONFLICT` inference unless the statement
repeats the predicate**, and `supabase-js`'s `upsert({ onConflict: "barcode" })`
cannot emit that `WHERE`. So every barcoded upsert failed with
*"there is no unique or exclusion constraint matching the ON CONFLICT
specification"* — HTTP 500.

**Net effect while it was broken.** `health_foods` stayed empty in both dev and
prod. The client failed open and silently fell back to reading Open Food Facts
directly, so nothing looked broken from the user's side — the tell was that
cached foods showed `source: "openfoodfacts"` and never `off_backfill`. The
community catalog simply never grew.

**Why a full unique index is safe.** A full unique index still treats NULLs as
distinct, so barcode-less rows (produce, front-of-package manual entries)
continue to coexist happily. Non-null barcode uniqueness is unchanged. The only
behavioural difference is that `ON CONFLICT (barcode)` can now infer the index.
Nothing is tightened.

**Rerun safety:** additive and idempotent — `drop index if exists` +
`create unique index if not exists`, converging to the same full unique index
either way. It applies through the normal path (`supabase-migrate.yml` on
`supabase/migrations/**`; CI is the sole applier).

Shipped alongside Conjure Health 1.7.0, together with the OFF g→mg mineral fix.

---

## health-ai-usage — Every `ai.complete()` call, tier and cost

There are **13 call sites**, all funnelled through `complete()` in
`src/bridge/ai.ts`. Tiers are declared per call and ConjureOS maps them:

| Tier | Anthropic model (`ConjureOS/src/ai/modelCatalog.ts`) | Rate (`ConjureOS/src/ai/pricing.ts`) |
|---|---|---|
| `cheap` | Haiku 4.5 | $1.00 / $5.00 per M in/out |
| `capable` | Sonnet 4.6 | $3.00 / $15.00 per M in/out |
| `epic` | Opus 4.7 | $5.00 / $25.00 per M in/out |

**Conjure Health never uses `epic`.** On the hosted free tier ConjureOS forces
every tier down to Haiku (documented at `ConjureOS/src/ai/adapterSelector.ts:19`), so free-tier
users get Haiku quality even on the `capable` calls — the *shape* of the response
is the same, the *quality* differs. That is the direct cause of several
historical bugs in this app (e.g. Haiku returning plan goals as plain strings,
which is why `parseCore` coerces string goals, alternate label keys, a `plan`
wrapper, and object-map goals).

### The call sites

| # | Location | Purpose | Tier | `maxTokens` | Live today? |
|---|---|---|---|---|---|
| 1 | `features/naturalLanguage.ts:55` | `parseMeal` — describe a meal in text, or a **photo of a plate**, → structured `FoodItem[]` | `capable` | 1024 | **Yes** |
| 2 | `features/foods/labelParse.ts:73` | `parseNutritionLabel` — vision-parse a Nutrition Facts panel photo | `capable` | 1024 | **Yes** |
| 3 | `features/foods/frontParse.ts:85` | `estimateFromFront` — estimate macros from the package front / produce / a beer | `capable` | 1024 | **Yes** |
| 4 | `features/calories.ts:93` | `estimateViaAi` — post-workout burn, only when the MET formula can't run (no bodyweight) | `cheap` | 60 | Only via the paused workout runner |
| 5 | `features/plan/generate.ts:237` | `generateCore` — plan summary + goals + calorie target | `capable` | 900 | **Yes** (the wizard) |
| 6 | `features/plan/generate.ts:263` | `generateProgramOnce` — the workout program, best-effort | `capable` | 4096 | Runs, but its output is never displayed while the flag is off |
| 7 | `features/plan/analyze.ts:260` | `analyzeAndAdapt` — periodic adaptation from logged sessions | `capable` | 1024 | Paused |
| 8 | `features/plan/analyze.ts:293` | `calibrateToBenchmark` — tune provisional workouts to a measured assessment | `capable` | 1024 | Paused |
| 9 | `features/plan/groups.ts:146` | Next-group progression | `capable` | 1024 | Paused |
| 10 | `features/coach/coach.ts:106` | `evaluateCheckin` — reply + memory notes + optional plan tweak | `capable` | 1024 | Paused |
| 11 | `features/coach/coach.ts:264` | `coachChat` — free-form trainer chat, last 16 turns | `capable` | 1024 | Paused |
| 12 | `features/coach/questions.ts:120` | `aiPick` — choose which 3 check-in questions to ask from a hardcoded bank | `cheap` | 128 | Paused |
| 13 | `features/explainers/resolve.ts:78` | Generate an exercise "how to do it" explainer, **cached to VFS** | `cheap` | 400 | Only via the paused workout surfaces |

### Rough cost intuition

Order of magnitude, using the Sonnet 4.6 rate ($3.00/$15.00 per M) and typical
prompt sizes. **For the hosted free-tier majority the real rate is Haiku 4.5's
$1.00/$5.00 (`ConjureOS/src/ai/pricing.ts:40`, the
`"claude-haiku-4-5-20251001"` entry in `MODEL_PRICING`) — roughly 3× lower than every
figure below** — because the free tier forces all three tiers to `cheap`:

- **Food logging calls (#1–#3)**: sub-cent per call for text; a photo pushes
  input tokens up (image blocks dominate) but still lands in the fractions of a
  cent to ~1¢ range. These are the **high-volume** calls — one per logged
  AI-estimated food.
- **Plan generation (#5 + #6)**: two calls, ~900 + ~4096 output tokens, plus a
  possible retry on each. Call it a handful of cents for a full plan build. This
  is the app's single most expensive user action, and it is why generation was
  split (a failed 4096-token call used to be paid for and then thrown away).
- **Coach chat (#11)**: the system prompt carries the whole context snapshot
  *and* the coach's memory, so input tokens are large relative to a 1024-token
  reply. Cheap per turn, but it is the one that grows with history.
- **The `cheap`-tier calls (#4, #12, #13)** are rounding errors. #13 is cached
  to VFS after the first hit, so the second view of an exercise is free.

The user pays: ConjureOS routes via the user's BYK key or the hosted free-tier
proxy, meters the spend kernel-side, and records it per app
(`ConjureOS/src/kernel/index.ts:1770` `recordAiSpend(this.currentApp, …)`,
inside `Kernel.dispatchAIRequest` at `:1698`). Apps also face a per-app rate cap
(`:1732` `checkAiRate(this.currentApp)`) and a **foreground gate** (`:1720`
`document.visibilityState === "hidden"`, plus an `appForeground` check) —
`ai.complete` is refused while ConjureOS is a background tab or the app's window
is minimized.

### Prompt-injection posture (applies to #1, #2, #3)

All three vision/NL paths take user-controlled input that may contain
adversarial text (a package could literally print "ignore previous
instructions"). The pattern is consistent and should be preserved:

- Every system prompt says text in the image is *content to identify*, never
  instructions to follow.
- Output is parsed as strict JSON with per-field validation, clamps and caps
  before it ever becomes a `FoodItem`.
- `frontParse` additionally **strips URLs from `warningNote`** so the model
  can't echo a phishing link out of package text.
- `labelParse` bails below a 0.4 confidence floor; `frontParse` uses a looser
  0.2 floor *and* makes the editable review screen **mandatory**, because that
  path is an honest guess rather than a label read.
- AI-derived foods are tagged `provenance.sourceTag = "ai_estimate"` so the
  diary badges them.

---

## health-cross-app — Cross-app: actions provided and needs consumed

Conjure Health is the platform's worked example for cross-app data flow, so this
section is the one most likely to be quoted in external developer docs. It is
also the highest-scrutiny path on the platform, because the payloads are
**health data** — see the App Review note at the end.

### Actions it provides

Declared in `package.json` → `conjureos.actions`, implemented in
`src/bridge/actions.ts`, registered once at startup via
`registerActions()` (`actions.ts:231`). The handler set and the manifest block
must be kept in sync — the manifest is the schema the host validates against.

| Action | Permission | Params | Returns |
|---|---|---|---|
| `logFood` | `actions.write` | `name` (required, ≤80), `calories?`, `protein?`, `carbs?`, `fat?`, `meal?`, `date?` | `{ id }` |
| `todayTotals` | `actions.read` | none | `{ date, total, goals, exerciseCalories, caloriesRemaining }` |
| `logRecipeMeal` | `actions.write` | `slug` (required), `servings?` (0.1–20, default 1), `meal?`, `date?` | `{ id, logged }` |
| `logWorkout` | `actions.write` | `calories` (required, 0–10000), `type?`, `durationMin?`, `date?` | `{ id, caloriesBurned }` |

> `README.md` lists only three actions. `logWorkout` was added in 1.14.x and the
> README was never updated.

**`logFood`'s calories are optional on purpose** (`actions.ts:68`). When a caller
names a food without numbers ("a McCrispy sandwich"), the app runs the same
`parseMeal` estimator the Describe tab uses and tags the result
`ai_estimate`. An explicit `0` (black coffee) is respected — only an *absent*
value estimates. This is what lets an assistant log a named food it has no
nutrition data for.

**`todayTotals` adds exercise back**: `caloriesRemaining = goal - eaten +
exerciseCalories`, and `exerciseCalories` comes from the same
`exerciseCaloriesForDate()` the diary ring uses — one source of truth, so the
action and the UI can never disagree.

**`logRecipeMeal` is composition inside the app** (the Phase 45 position: a
single self-executing action, so the orchestrator stays a cheap single-action
router). It fetches the recipe from the provider, copies per-serving nutrition
into the diary, and marks the recipe cooked. If the provider app isn't running
it converts the kernel's `TARGET_NOT_RUNNING` into
`NEEDS_APP_OPEN:<appPath>` (`actions.ts:198`), a marker the shell catches to
open the provider and retry the whole action, rather than misreporting a missing
recipe.

**Input hardening.** Params come from other, untrusted apps. Every field goes
through `asObject` / `asString` (trimmed, length-capped, control characters
stripped) / `asNonNegInt` (finite, non-negative, clamped, rounded) / `asMeal`
(enum, defaults by time of day) / `asDate` (strict `YYYY-MM-DD` regex).
`logRecipeMeal` additionally lowercases the slug and strips it to `[a-z0-9-]`.

`logWorkout` validates `type` and `durationMin` even though the persisted
`WorkoutSession` doesn't store them yet — a bad caller is rejected rather than
silently accepted for a field that will exist later.

### The need it consumes

One: `recipeSource`, declared in `package.json` → `conjureos.needs`, consumed by
`src/bridge/recipeBridge.ts`.

Provider resolution, in order (`recipeBridge.ts:6`):

1. **Phase 45 discovery.** `actions.discover("recipeSource")` returns
   `ProviderMatch[]`; invokes pass `{ normalize: "recipeSource" }` so results
   come back in the need's canonical shape. **No app paths or action names are
   hardcoded.** An empty result is a *normal state* — no provider installed, or
   the user turned cross-app connections off — and degrades quietly to "no
   recipes". It is re-checked on the next call, so installing a provider
   mid-session works.
2. **Legacy hosts** with no `discover`: the pre-45 `actions.list()` scan for an
   app exposing `getRecipe`, invoking literal action names.
3. **No bridge at all** (plain `npm run dev`): bundled mock recipes.

**A schema-matching gotcha worth preserving** (fixed in 1.8.0): "From your apps"
never surfaced recipes because `schemaSatisfies` rejected the match. Two causes:
the Recipes provider declares no `required` arrays, so our consumer-required
fields weren't provider-guaranteed; and our need's `nutrition` used a
`["object","null"]` union, and `schemaSatisfies` fails closed on unions. The fix
was to relax the need — drop the `required` arrays, leave `nutrition`
unconstrained and read it defensively. The `nutrition` property's `description`
in `package.json` documents exactly this. The underlying platform gap
(`schemaSatisfies` has no nullable-union support) is noted against
`@conjureos/bridge`.

Reads (`listRecipes`, `getRecipe`) are `actions.read` and side-effect-free, so
no grant prompt. `markCooked` is `actions.write`, triggers the one-time
per-caller grant, and is an optional nicety — in discovered mode it only fires
when the matched provider actually exposes it.

Search results fetched cross-app show an **app pill** (ConjureOS diamond glyph +
provider name, e.g. "◆ Recipes") on the title row, so data fetched from another
app is visibly attributed — `className="app-pill"` with `DiamondIcon`,
`AddFoodScreen.tsx:322-324`. Do not confuse it with `.source-pill`, an unrelated
class used in the exercise view for wearable-vs-in-app labels
(`WorkoutsScreen.tsx:164`, `:200`).

### Health data and App Review

Everything above moves **health data between apps**. That makes it the highest-
scrutiny path on the platform: Apple's Guideline 4.7.1 (mini-apps / software not
embedded in the binary) and Guideline 5.1 (Data Collection and Storage,
including the HealthKit-specific rules) both bear on it, tracked in
`Jonny-B/conjureos-mobile#2`.

Practical implications when changing anything in this section:

- **Know the one outbound path: community-catalog contribution is automatic,
  unconditional, and stamped with the user's id.** Every food saved through the
  AI-review or "Looks wrong?" screen is uploaded to the shared catalog —
  `onSave` calls `contribute({ food, source, aiConfidence, userEdited })`
  unconditionally at `EditableNutritionPreview.tsx:103`, its only call site in
  `src/`. There is no opt-in, no opt-out, and no per-save toggle; the UI
  surfaces only the *failure* ("Logged to your diary. We couldn't share your
  edit with the community this time.", `:118-120`), which confirms sharing is
  the default rather than an election. The payload is the whole food row — name,
  brand, barcode, serving size and grams, and 19 nutrient fields, 24 in all
  (`conjureHealthDb.ts:192-220` `foodItemToPayload`) — and the
  server stamps `contributed_by: userId` (`health-foods-db/index.ts:393`).
  **On desktop there is no consent prompt of any kind:** `call()` uses the
  existing `getAccessToken()` session and only falls back to a minted token for
  `WRITE_ACTIONS` (`conjureHealthDb.ts:64`, `:75-78`), so the one-time
  ConsentSheet described in `health-decisions-other` (2026-07-16) is a
  consequence of the *mobile minted-token* path, not a contribution consent.
  **Mitigations that are real:** the rows are food catalog data, never diary
  entries or health metrics; `display_attribution` defaults false
  (`090_health_foods.sql:101`) and the public view nulls `contributed_by` unless
  it is set (`090_health_foods.sql:299`, and `stripContributor` at
  `health-foods-db/index.ts:569`), so contributors are not publicly exposed. Filed as **conjureos-fitness#71** (2026-08-21). If App
  Review or a privacy label asks "what leaves the device", **this is the
  answer** — describe it accurately rather than discovering it in review.
- Health data must not be used for advertising or sold to data brokers, and must
  not be written to iCloud or any third-party storage without explicit consent.
  The community food DB deliberately stores **food catalog rows**, not user diary
  entries; `scanned_by` on `health_food_scan_attempts` is nullable specifically
  so it can be scrubbed.
- Every cross-app read Conjure Health *serves* goes through the kernel's
  permission + grant machinery. Do not add a path that bypasses
  `registerActions` or hands data to a caller without the declared permission.
- The Supabase JWT never enters the mobile WebView (see
  `health-mobile-healthkit`). Do not weaken that to make a cross-app flow
  simpler.
- New actions that emit health data should be `actions.read`-gated only if they
  are genuinely side-effect-free, and should be reviewable in the manifest —
  the manifest is what App Review and the user both see.

---

## health-mobile-healthkit — Mobile: the HealthKit path

Conjure Health reads wearable workout calories via a native broker that exists
**only in the ConjureOS mobile app**. On desktop the call rejects with
`reason: "unsupported"`, which is why the client feature-detects rather than
assuming.

### Read this first: the whole path is behind a build flag

**HealthKit / Health Connect is compiled in only when
`EXPO_PUBLIC_CONJUREOS_HEALTH === "1"`.** This is the single most practical
thing to know in this section, because it means the verification loop
`conjureos-mobile/CLAUDE.md` prescribes cannot exercise Health at all.

- `conjureos-mobile/app.config.ts:22` — `const health = process.env.EXPO_PUBLIC_CONJUREOS_HEALTH === "1";`
- `conjureos-mobile/app.config.ts:93` — `if (health) { … }` is what pushes the
  `@kingstinct/react-native-healthkit` and `react-native-health-connect`
  plugins. Off → the native modules are simply not in the bundle. The comment
  at `:88-92` explains the flag is deliberately **decoupled** from
  `EXPO_PUBLIC_CONJUREOS_MINIMAL` so a build can add HealthKit without
  re-enabling widgets / share-extension / push — one bundle ID, one added
  capability, the lowest-risk provisioning delta.
- `conjureos-mobile/eas.json:40` — `EXPO_PUBLIC_CONJUREOS_HEALTH: "1"` appears
  **only** in the `testflight` profile. The `development` and `preview` profiles
  do not set it.
- With the module absent, `loadHK()` (`healthOps.ts:37-49`) returns null, so
  `runHealthOp`'s iOS `available` branch returns
  `platform: HK ? "ios" : "unsupported"` (`healthOps.ts:392`) — the app degrades
  cleanly to "no wearable calories", which is why nothing looks broken.

**Consequence for whoever is finishing this app.** `npx expo run:ios` /
`run:android` dev clients — the loop `conjureos-mobile/CLAUDE.md` names as "real
verification" — report `unsupported` and cannot test any of this. The only
profile that carries the flag is `testflight`, and per that same CLAUDE.md the
`testflight` profile is **all-prod**, so reaching it requires a dev→main
promotion *and* an EAS build. EAS builds cost real money on the owner's plan and
**must not be triggered without asking first**. Practical upshot: treat any
change to `src/bridge/health.ts` or `src/features/exercise.ts` as unverifiable
on-device until a Health-flagged build exists, and say so rather than claiming it
was tested.

### The app side

`src/bridge/health.ts` is the whole client surface. It wraps
`window.__conjureos.native.health` and degrades to empty:

- `isHealthAvailable()` → `available()` probe, `false` on any failure.
- `readWorkouts(sinceMs, untilMs)` → `read({ types: ["workouts"], since, until, limit: 200 })`,
  filters `kind === "workout"`, maps to `WorkoutBurn` (`workoutType`, `start`,
  `end`, `caloriesBurned` from `activeEnergyKcal ?? totalEnergyKcal`,
  `distanceMeters?`, `source?`).
- `readBurnedForDate(date)` sums a **local** calendar day — note the deliberate
  absence of a trailing `Z` in `new Date(\`${date}T00:00:00\`)` so it parses in
  the device's timezone (`health.ts:97`).

The point of one integration per OS aggregator: an Apple Watch run lands in
HealthKit automatically, and Fitbit / Strava / Oura land there too once the user
enables their own sync. No per-device integration.

`src/features/exercise.ts` combines wearable and in-app workouts. Calories from
both sources **add** (they're distinct efforts). Because the app cannot delete
from Apple Health, "removing" a wearable workout excludes it locally
(`DailyCheckoff.excludedWearableKeys`) and "editing" it stores a kcal override
(`wearableKcalOverrides`) — both per-day and reversible. Wearable workouts are
keyed `${start}-${workoutType}` because HealthKit gives no stable id
(`exercise.ts:45`).

### The mobile-app side (three gates, plus a fourth path)

`conjureos-mobile/src/bridge/handlers.ts:304` `handleHealth`:

- `available` is a **benign capability probe** — no manifest or consent gate, so
  an app can decide whether to show wearable UI before asking for anything.
- **Gate 1** — the manifest must declare `native.health`.
- **Gate 2** — per-(app, permission) user grant, the same Allow-once / Always /
  Block trichotomy as the other `native.*` ops. **This gate is conditional and
  fails OPEN:** the whole check is wrapped in `if (ctx.grants)`
  (`handlers.ts:318`) and `grants` is optional on `HandlerContext`
  (`handlers.ts:114`). A host that constructed a handler context without a
  grants store would skip consent entirely and fall through to `healthOps`,
  leaving only Gate 1 and the OS sheet. **Mitigation, stated for accuracy:**
  today's shipped Runner always supplies it — `grants: kernel.grants` in the
  handler-context literal at `Runner.tsx:420` (the identical line at `:412` is
  a different thing: the `invokeRemoteAction({…})` options for the cross-app
  path, not `ctx.grants`) — so the gate holds on today's build — this is latent, not live. Tracked as
  **conjureos-mobile#7** (2026-08-21). Note the cross-app action gate in the
  same file was already hardened the other way: `handlers.ts:542` fails
  **closed** with an explicit comment that "a consent gate must FAIL CLOSED".
  Do not construct a handler context without grants, and do not describe this
  gate as unconditional.
- **Gate 3** — the OS HealthKit / Health Connect authorization, requested lazily
  inside `conjureos-mobile/src/native/healthOps.ts`.

Transport is a dedicated shim (`conjureos-mobile/src/bridge/shim.ts:112`
`HEALTH_SHIM`): app → kernel via `ReactNativeWebView.postMessage` with
`type: 'health.request'`, kernel → app via the injected `__conjureosDeliver`
dispatcher, 60s timeout. It *augments* `window.__conjureos.native` rather than
replacing it, so camera/photos/share/location stay intact.

### The separate priming path — this is the bit that's specific to Health

`primeHealthAuth()` (`conjureos-mobile/src/native/healthOps.ts:366`) is **not**
one of the standard native ops. It is shell-level HealthKit authorization
priming, fired from the **Home screen**, and it is called from exactly one place:
`conjureos-mobile/app/index.tsx:193` — the `{ text: "Connect", onPress: () =>
void primeHealthAuth() }` button of the pre-prompt `Alert`, inside the
`native.health` effect that starts at `:174`.

The flow (`app/index.tsx:174`):

1. iOS only. Android's Health Connect permission activity needs the in-app flow,
   which already handles it lazily.
2. It fires as soon as **any installed app declares `native.health`** — which in
   practice means Conjure Health. Not on Health's first Diary read.
3. An `AsyncStorage` flag `conjureos.healthPrimed.v1` makes it one-shot, so a
   no-op request doesn't re-run on every Home mount.
4. A **guided pre-prompt** appears first: *"On the next screen, tap 'Turn On
   All', then Allow."* Owner call, 2026-07-23. The reasoning: Apple's sheet
   starts with every toggle OFF, and tapping "Allow" with toggles off grants
   nothing — users who tap through end up silently denied. Pre-checked toggles
   are forbidden by Apple, so telling the user exactly what to tap right before
   the sheet appears is the best legal move.
5. `primeHealthAuth` requests read auth for the **full** broker type set
   (`HKWorkoutTypeIdentifier` + every quantity type), not just workouts. iOS
   shows its sheet once; later calls are no-ops.
6. Declining leaves the lazy in-app request as the fallback. The per-app
   ConjureOS consent still gates actual reads inside the app — priming the OS
   permission does not grant the app anything.

**Hard rule that constrains everything here:** the Supabase JWT never enters the
WebView on mobile. `auth.getUser` / `getAccessToken` return `null` for every
app. That is why community-DB writes take the minted-token path (see
`health-backend-foods-db`). Do not weaken it.

### The stale-manifest trap

Conjure Health 1.14.1 shipped `native.health` + `logWorkout`, but
`kernel.applyStoreUpdate` re-stamped the *install-day* manifest, so updated apps
ran new code against old permission and action lists — mobile health sync was
silently dead. Fixed 2026-07-23 in both desktop (`0.38.6`,
`refreshAuthorFields()` in `manifest.ts`) and mobile (`0.8.4`–`0.8.6`). If a
newly-declared permission appears absent at runtime after an update, this is the
first thing to check.

---

## health-safety-layers — The five safety layers (and which are live)

The 2026-06-24 decision specified five hardcoded safety layers shipped in the
bundle. Status as of 2026-08-21:

**Layer 1 — intake gate. LIVE.** `src/features/safety/intakeGate.ts`.
`requiresLoggingOnly(intake)` returns true for `ageBand === "under_18"`,
`pregnant`, or `cardiacFlag`. `resolveSafeMode(requested, intake)` collapses any
gated intake to `logging_only` **at plan creation**, so a stored `Plan.mode` is
always already-safe and downstream code never re-checks. The workout surface is
**hidden, not disabled** — no teasing controls (`App.tsx:263` `loggingOnly`).

**Layer 2 — injury-region exclusions. LIVE, with a format deviation.** The
recorded decision specifies a *"static **JSON** in bundle"*
(`ConjureOS/DECISIONS_ARCHIVE.md:72`). The implementation is a **typed TS
module**, `src/features/safety/injuryExclusions.ts` — deliberate (values are
type-checked and there is no loader dependency; the file's own header says so),
and it is the right call, but it *is* an unrecorded deviation from the decision
and is noted here because that is what the decision layer is for. Recipes hit
the same wall from the other direction: the store bundler's loader map does not
cover `.json`, so a JSON import returns `undefined` in a store build. Maps an injury region to movement
patterns that must not be prescribed. Matching is case-insensitive **name
substring** — deliberate, because the workout library is name-keyed and has no
movement taxonomy, and patterns are kept broad ("squat" catches "Goblet Squat",
"Split Squat"). Consumed by `features/plan/validate.ts`,
`features/plan/generate.ts` (injected into the prompt as a hard avoid-list),
`features/plan/fallbackTemplates.ts`, and `WizardScreen`.

**Layer 3 — pre-LLM symptom classifier. WRITTEN BUT UNWIRED.**
`src/features/safety/symptomKeywords.ts` exports `STOP_SYMPTOMS`,
`detectStopSymptom()` and `isStopSymptom()`. **Verified 2026-08-21: nothing
imports this module.** It was designed to screen the "Tell coach" mid-session
reprompt text before any model call, and that reprompt bar was never built. The
coach chat (`CoachScreen` → `coachChat`) does **not** run it. If the coach is
un-paused, wiring this is a prerequisite, not an optional extra.

**Layer 4 — plan-gen prompt rails + post-gen validator. LIVE.**
`src/features/plan/validate.ts`. Three rails: a sex-specific kcal floor (1200 F
/ 1500 M / 1500 default, `features/plan/model.ts:75`), injury exclusion on every
goal and every program exercise, and an intensity cap (≤6 workout goals, ≤6
workouts **per group**, 1–4 benchmarks). `validateProgram` is shared by initial
generation, the adaptation engine, the group-progression step and the coach's
plan changes — so an AI-adjusted program clears the exact same gate a generated
one does. Failure path: retry once with the rejection reasons fed back, then
drop to a hardcoded fallback template. `fallbackProgram` is experience-scaled
(beginner / intermediate / advanced tiers) so an advanced goal never gets
"Sit-to-Stand".

**Layer 5 — three disclaimer surfaces. PARTIAL.**
`src/components/DisclaimerCard.tsx` is the single source of truth for the copy
(`DISCLAIMER_HEADLINE`, `DISCLAIMER_BODY`, `DISCLAIMER_SHORT`). Two surfaces
exist: the first-run "I understand" card (`WizardScreen.tsx:349`) and the
plan-review inline notice (`WizardScreen.tsx:741`). The third — the persistent
coach footer — is moot while the coach is hidden; `CoachScreen` does not import
the disclaimer module. The liability acknowledgement timestamp lives on
`plan.liability` (`LiabilityAck`, `types.ts:367`), which is the single canonical
home.

**Coach-side rails that do exist.** Even though layer 3 is unwired, the coach is
not unconstrained: `CHAT_SYSTEM_BASE` (`features/coach/coach.ts:45`) tells it
"You are NOT a doctor — for pain, injury, or medical questions, advise seeing a
professional", and every plan change it proposes is applied through
`applyAdjustment` + `validateProgram` (`coach.ts:65`), so a failed parse or
validation is a strict no-op. Plan changes are **ask-first**: the coach emits a
`<propose>` block rendered as choice chips; an `<adjust>` only applies when the
user is answering a prior proposal, and a cold `<adjust>` is converted into a
confirm proposal (`MAX_PROPOSAL_ROUNDS = 2`).

---

## health-coach-pause-flag — The coach/workout pause flag

`src/features/flags.ts`, one constant:

```ts
export const COACH_AND_WORKOUTS_ENABLED: boolean = false;
```

Owner decision, **2026-08-14**, shipped in `1.21.0`. Conjure Health ships as a
focused weight-loss + nutrition tracker so there is a product to put in front of
people. The coaching and workout work is **not cancelled and not deleted** — it
is switched off at the surface.

**It is deliberately a plain module constant, not runtime config.** Flipping it
is a code change that goes through review, a build and a publish. A paused
feature should not be one tapped setting away from reappearing in a user's app.

### What it hides

- The Workouts tab, the built-in workout library and the workout runner
- The Coach chat tab and the Plan tab's coach launcher
- The evening "how did your day go?" check-in banner + sheet
- The Plan tab's program section (assigned workouts + benchmark progress)
- **Settings → the workout program editor**, indirectly: the sub-view still
  exists in `SettingsSheet`, but every entry point into it is inside a
  flag-gated program section, so the cog is units + resets only while the flag
  is off
- The plan wizard's mode picker — plans are forced `eat_better`
- The coach/workout rows in Settings → Reset health data

### What deliberately stays ON

- **Apple Health / wearable exercise calories.** They adjust the day's calorie
  budget, which makes them a *nutrition* feature. The ring's Exercise row still
  opens a list of the day's workouts so those numbers can be corrected or
  removed — `WorkoutsScreen`'s `exerciseOnly` mode.
- **The `logWorkout` cross-app action**, for the same reason.
- **All stored data.** Existing plans keep their `program`; `coach.json` and
  session history are untouched on disk. Nothing migrates, nothing is wiped.
- **All the paused code and its tests**, so it keeps compiling and can't rot
  silently while switched off.

### Turning it back on

Set it to `true`. Everything returns, including existing users' programs,
because no data was removed. Then re-check the things the flag does **not**
restore on its own, per the checklist at `flags.ts:37-44`:

1. `package.json` → `conjureos.description` + `promptSuggestions`, rewritten to
   describe a nutrition-only app.
2. The wizard's step numbering/titles, which assume a nutrition-only flow.

Add to that checklist, from this review: **wire safety layer 3**
(`symptomKeywords.ts`) and decide what to do about the missing persistent coach
disclaimer footer.

### It is tested

`src/features/flags.test.ts` asserts the flag is off, that the coach/workout
reset rows are hidden, that the nutrition-side resets remain, and — importantly
— that `HISTORY_ITEMS` still contains every kind so `clearAll` can still wipe
the hidden slices. Hiding a row must never make data unwipeable.

### Not recorded in ConjureOS DECISIONS.md

Verified 2026-08-21: the pause is documented in this repo (`flags.ts` doc
comment + repo `STATUS.md`) but there is **no dated entry for it in
`ConjureOS/DECISIONS.md` or `DECISIONS_ARCHIVE.md`**. That is a gap worth
closing — it is exactly the kind of cross-cutting product call the log exists
for, and ConjureOS `STATUS.md:34` still describes 12b as "plan wizard + daily
check-off home + AI workout coach" with no mention of the pause.

---

## health-build-publish — Build, version and publish

### Scripts

```
npm run dev           # vite, port 5181
npm run build         # tsc -b && vite build          → dist/ (split assets)
npm run build:inline  # tsc -b && vite build --mode inline → dist/index.html, everything inlined
npm run typecheck     # tsc -b --noEmit
npm test              # vitest run
```

### Versioning — ONE place, not two

**Conjure Health has no `src/version.ts`.** Bump `version` in `package.json` and
nothing else. `vite.config.ts:8` reads it at build time and injects it as
`__APP_VERSION__`; `App.tsx:389` renders it as `v{__APP_VERSION__}` in the
footer.

The "bump it in two places" rule comes from
`ConjureOS/ANCHOR_APP_CI_SETUP.md:231-236` — *"Bump the app's version on **every**
publish — `package.json` **and** `src/version.ts` together"* — which is written
unscoped and therefore reads as applying here. It does not: the CI guard is
conditional. `ConjureOS/.github/actions/publish-anchor-app/action.yml:155` only
compares `package.json` against `src/version.ts` **if that file exists**, and
skips the check otherwise, so there is nothing here to get out of sync. The
same repo already documents the carve-out at
`ConjureOS/docs/internal/ONBOARDING.md:993`: *"Fitness and Finance do not
currently carry a `src/version.ts`; guard 1 is skipped."* The two-place
convention is real for **Recipes** (`conjureos-app-recipes/CLAUDE.md`), which
does carry the file. Guards 2 and 3 (byte-identical and semver checks in the
`store-version` edge function) still apply to every app, including this one.

### The publish workflow

`.github/workflows/publish-store.yml`. Two triggers, two targets:

| Trigger | Supabase project | Meaning |
|---|---|---|
| `workflow_dispatch` (with an optional `changelog` input) | **DEV** | Test against `dev.conjureos.pages.dev`; publishes to dev users |
| `release: published` | **PROD** | Ships to real users |

Steps: checkout → Node 20 → `npm ci` → `npm run build:inline` with the
target project's `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` baked in →
resolve the changelog → check out the ConjureOS repo with a read-only PAT
(`CONJUREOS_REPO_TOKEN`) → run the local-path composite action
`./.conjureos/.github/actions/publish-anchor-app` with
`html-path: dist/index.html`, `slug: fitness`.

Notes that will save you time:

- **The anon key is baked at build time and is public by design** — it ships in
  every browser and RLS gates everything. It is inlined in the workflow rather
  than stored as a secret. The *only* per-repo secrets are the bot passwords
  (`PUBLISH_BOT_DEV_PASSWORD`, `PUBLISH_BOT_PROD_PASSWORD`) and
  `CONJUREOS_REPO_TOKEN`. The project URL is derived from the existing
  `SUPABASE_DEV_PROJECT_REF` / `SUPABASE_PROD_PROJECT_REF` secrets.
- The client SDK needs those baked vars to reach `health-foods-db`; without them
  `FN_URL` is empty and the community DB silently isn't used.
- **Release text goes through `env:`, not `${{ }}` interpolation.** Backticks and
  quotes in release notes otherwise land in the shell as command substitution and
  crash with exit 127. Same fix the Recipes workflow took (DECISIONS 2026-06-21).
- GitHub can't resolve an action in another **private personal** repo via
  `uses: Jonny-B/ConjureOS/...@dev`, hence the checkout-then-local-path dance.
- `concurrency: publish-store-${{ github.ref_name }}`, `cancel-in-progress: false`.

### There is no PR/push CI

`.github/workflows/` contains only `publish-store.yml`. Typecheck and tests are
local gates, not enforced ones. Run `npm run typecheck && npm test` before
pushing.

### Known publish friction, historically

Several past publishes were done out-of-band because the automation couldn't
dispatch Actions and/or the prod store row was missing:

- The **sanctioned backdoor** (ANCHOR_APP_CI_SETUP.md → "Manual / backdoor
  publish"): mint a bot token from the service-role key
  (`ConjureOS/scripts/mint-bot-token.mjs`), then `scripts/publish-app.mjs` with
  `PUBLISH_BOT_ACCESS_TOKEN` — dev as a version bump, prod as
  `--first-publish --featured`. Used for the 2026-07-11 relaunch.
- A one-off **throwaway-branch push trigger** was used for the 1.2.0 prod
  publish. That branch's workflow was neutralized afterwards. Don't revive it —
  the prod store row exists again, so normal CI (a GitHub Release) works.

### Mobile does not auto-detect a store publish

Its Home grid syncs `public.files` (no version concept), and the only update
check (`get_my_app_updates` RPC on the Store screen) needs a `store_app_installs`
row. A store publish never rotates the user's `public.files`, so nothing lights
up on the grid. That's a mobile/backend gap, not a publish-flag problem.

### Branch flow

This repo does **not** mirror ConjureOS's `dev` → `main` flow. It has `main`
plus feature branches (`claude/...`). As of 2026-08-21, `origin/main` is at
`eacf65f` (1.23.1); code work happens on `claude/…` branches off it.

---

## health-decision-rename — Decision: the rename that isn't a rename

**Recorded:** ConjureOS `DECISIONS_ARCHIVE.md`, **2026-06-24** (the Phase 12b
v2 entry). Also `PHASE_12_DESIGN.md` §12b heading, and `README.md` in this repo.

**The reasoning first.** The v2 scope turned a calorie tracker into a health app.
"Conjure Fitness" no longer described the product. But the App Store slug is the
dedupe and install key, and the repo name is wired into CI, the publish
workflow's `slug: fitness`, and the store row. Changing the slug means a
disruptive App Store re-publish: a new listing, users' existing installs not
matching, and the install/update path needing care. That cost is real and the
benefit — a tidier identifier — is cosmetic.

**The call: rename the display side only.**

| Thing | Value | Changed? |
|---|---|---|
| Display name | `Conjure Health` | ✅ renamed |
| Window / page title | `Conjure Health` | ✅ renamed |
| In-app brand text + icon | apple mark, `fa:apple-whole` | ✅ renamed |
| App Store slug | `fitness` | ❌ unchanged |
| GitHub repo | `Jonny-B/conjureos-fitness` | ❌ unchanged |
| npm `name` | `conjureos-fitness` | ❌ unchanged |
| Cross-app action names | `logFood`, `todayTotals`, `logRecipeMeal` | ❌ unchanged |
| `localStorage` key | `conjure-fitness:store:v2` | ❌ unchanged |
| Supabase schema name | `fitness` | ❌ unchanged |

"Revisit the disruptive rename when v2 publishes" was the stated follow-up. As of
2026-08-21 it has **not** been revisited, and given the app has now shipped many
store versions under `fitness`, the cost of changing it has only gone up.

### The trap this sets

A newcomer searching for the product by name finds nothing, and a newcomer
reading the repo assumes it is a fitness app. Concretely:

- The repo, the folder, the package name and the slug all say "fitness".
- Internal identifiers and log prefixes say fitness:
  `[conjure-fitness] using mock data layer`, `LOCAL_KEY = "conjure-fitness:store:v2"`,
  `.env.example`'s header comment "Conjure Fitness — environment configuration",
  `src/bridge/actions.ts:2` "Cross-app actions Conjure Fitness exposes",
  `src/bridge/vfs.ts:7` "Conjure Fitness uses the VFS for two things".
- The publish workflow's header comment says "Builds Conjure Fitness…".
- ConjureOS `STATUS.md` refers to it variously as "Fitness", "Fitness/Health"
  and "Conjure Health" in the same table cell.

**Rule of thumb:** if you're reading a *user-facing string*, it should say
Conjure Health. If you're reading an *identifier*, it will say fitness, and that
is correct — do not "fix" it. Changing any of the identifier column above is a
breaking change that requires a store migration, not a rename.

Ironically, the app is now shipping as a *nutrition tracker* with workouts paused
(see `health-coach-pause-flag`), so the original name would have been the less
accurate of the two anyway.

---

## health-decision-v2-scoping — Decision: scoping v2 (2026-06-24)

**Recorded:** ConjureOS `DECISIONS_ARCHIVE.md` under `## 2026-06-24`;
`PHASE_12_DESIGN.md` §12b (rewritten in the same change); ConjureOS
`STATUS.md:34`.

**The reasoning.** v1 (Conjure Fitness `0.2.4`) had been live in the dev and prod
stores since 2026-06-04 and covered the original "AI-native calorie tracker"
thesis completely: diary with ring + macro bars, four ways to add food, weight
trends, a workout library with a guided player, Mifflin-St Jeor goals, three
cross-app actions, and a clean Repository pattern. The thesis worked; the app
just didn't *keep* anyone. What was missing was a reason to come back tomorrow —
a plan, and something that reacted to how the plan was going.

**The call.** Keep v1 whole as the foundation. Layer three things on top:

1. **A first-run wizard** capturing a plan mode, a *short* safety intake, and a
   **finite** plan (1–4 weeks). Finite on purpose: an open-ended plan has no
   moment where you succeeded.
2. **A daily check-off home** that becomes the default tab once a plan exists.
3. **An AI workout coach** augmenting the existing deterministic player with a
   "Tell coach" mid-session reprompt.

Plus, in the same decision: the display-only rename (`health-decision-rename`),
the VFS persistence call (`health-decision-vfs-not-supabase`), the five safety
layers (`health-safety-layers`), and "**build path unchanged: Vite stays**" —
correcting a generalising line in `STATUS.md` that claimed anchor apps were
de-Vited when only Recipes actually was.

**Six GitHub issues opened on `Jonny-B/conjureos-fitness`, P0–P5 (#57–#62):**

| Issue | Scope | Estimate |
|---|---|---|
| P0 #57 | Domain model + Repository extension (Mock impl) | ~5–6 hr |
| P1 #58 | Safety static assets (exclusion list, keywords, DisclaimerCard) | ~4 hr |
| P2 #59 | Wizard + plan generation + validator + fallback templates | ~10–12 hr |
| P3 #60 | Home screen (conditional, one component, two booleans) + daily check-off | ~6–8 hr |
| P4 #61 | AI workout coach + Tell-coach bar + symptom classifier + reprompt validator | ~12–14 hr |
| P5 #62 | Settings + `notify` permission + disclaimer + ToS link + publish | ~5–6 hr |

**Estimate: ~42–50 productive hours, ~5–6 weeks of evenings.**

**How it actually went** (see `health-v2-scope` for the per-issue detail): P0,
P1 (partly) and P2 landed roughly as scoped. P3's check-off never shipped —
the home became the Diary plus a plan card. P4's coach was built far beyond the
original scope (memory, ask-first proposals, group progression, benchmark
calibration) and then paused; its Tell-coach bar and reprompt validator were
never built. P5's `notify` permission was never added. The calendar ran roughly
2026-06-24 → 2026-08-19 — about double the estimate, with the shape changing
substantially en route.

**Adjacent backlog left open at scoping:** repo issues #51 ("Programs:
multi-week structured plans"), #50, #52, #53, #54 (the coach-authoring lineage).
The v2 wizard partially addresses #51's data-model gap.

---

## health-decision-vfs-not-supabase — Decision: v2 data lives in VFS, not Supabase

**Recorded:** ConjureOS `DECISIONS_ARCHIVE.md` 2026-06-24; `PHASE_12_DESIGN.md`
§12b "v2 data layer"; and in the code at `src/data/repository.ts:41` and
`src/data/supabaseRepository.ts:187`.

**This is the unusual one. Read the reasoning before you "unify" it.**

**The reasoning.** v2 introduces three new data shapes: the plan, the daily
check-off record, and workout sessions. Putting them in Supabase means new
tables, new RLS policies, new GRANTs, a migration, and a schema that then has to
be kept in step with a client that is iterating weekly. Owner's call, in his own
words: this data should live **"as part of the user's storage."**

Three things follow from that framing:

1. **Phase 9 platform sync already backs up VFS files.** So "put it in the VFS"
   is not "don't back it up" — the platform's own sync covers it, for free, with
   no per-app schema.

   > ⚠️ **This premise was later eroded, and the decision has never been
   > revisited in that light.** A subsequent fix made `localStorage` the
   > authoritative store precisely *because* it is **not** cloud-synced
   > (`mockRepository.ts:52` `LOCAL_KEY`; `init()` at `:164` deliberately does
   > not consult the VFS copy once a device-local one exists). The VFS
   > `store.json` written by `flush()` (`:192`) is now a **seed for a new
   > device, not a live backup** of the authoritative copy. So the plan,
   > day-log and workout-session data this decision placed in the VFS is, in
   > practice, backed up only as far as the last mirror write — and is never
   > read back on a device that already has local state. **The decision still
   > stands on points 2 and 3 below (no new Supabase surface; genuinely
   > per-device data). It no longer stands on point 1 as originally written.**
   > See `health-persistence-split` for the mechanism and the bug that forced
   > it.
2. **No new Supabase surface at all** — no tables, no RLS, no migration, nothing
   to keep in step. The plan schema could change every week while it was being
   designed, and it did.
3. **The plan is genuinely per-device-user data**, not shared or queryable. There
   is no server-side feature that needs to read it.

**The call.**

- Plan, daily check-off and workout sessions persist as **VFS app data** via the
  `MockRepository` extension.
- `SupabaseRepository` keeps the v1 surface only: **profile, goals, diary,
  weight**.
- Every v2 method on `SupabaseRepository` throws
  `PLAN_REQUIRES_V2_BACKEND` — a clean, named, catchable sentinel, not a silent
  no-op and not a half-working stub.

**Why a throwing stub rather than a shared implementation.** A stub that
*silently succeeded* would look like it worked and lose data. A stub that
returned `null` would make "no plan" indistinguishable from "backend can't do
plans". A named error lets callers detect the unsupported backend and route plan
data through the mock layer instead, and it makes the gap visible in a stack
trace instead of in a support ticket.

**Where it actually lands on disk** (see `health-persistence-split` for the full
mechanism): `localStorage` key `conjure-fitness:store:v2` is authoritative and
un-synced; VFS `store.json` is a best-effort mirror that only seeds a brand-new
device. Separate VFS documents: `plan-archive.json`, `coach.json`,
`coach-chat.json`, `food-cache.json`, `explainers/user/<key>.json`,
`explainers/ai/<key>.json`.

**Cloud sync of plans was explicitly deferred to v3.**

### If you are tempted to unify this

The obvious refactor — "make `SupabaseRepository` implement the v2 methods too,
so both backends are complete" — undoes a deliberate decision and buys nothing
today, because **there is no live fitness Supabase backend**: no `profiles` or
`goals` tables exist in the shared dev project, and every user is on the
VFS/`localStorage` path anyway. Implementing v2 tables would mean writing and
maintaining a schema nothing reads.

The genuinely useful future work is the opposite direction: v3 cloud sync of
plans, decided deliberately, with a merge strategy — because the current
whole-document last-write-wins flush is exactly what caused the multi-surface
clobbering bug that `localStorage`-as-truth was introduced to fix.

---

## health-decisions-other — Other recorded decisions

Chronological. Each is a real recorded call, with the reasoning first.

**Anchor-app backends live in the ConjureOS repo, not their own repo or their
own Supabase project** (DECISIONS_ARCHIVE, the "Consolidation" entry). A
separate backend repo was drafted and its first CI deploy failed with
*"Remote migration versions not found in local migrations directory"* —
`supabase db push` enforces remote-ledger = local-files, which can't hold when
two repos push to the same project. The natural fix (one project per backend) is
+$25/mo per anchor app at prod on a pre-revenue product. So: migrations and edge
functions live in `ConjureOS/supabase/`; frontends stay in their own repos;
secrets stay in Edge Function Secrets, never committed. Schema isolation
(`finance.*`, `fitness.*`) keeps PostgREST exposure controllable. Trade-off
absorbed: anchor-app backend code is visible in the ConjureOS repo.

**The community food DB lives on the platform Supabase project; store every
unique miss** (2026-06-25, DECISIONS_ARCHIVE:67). Three layers landed together:
barcode scanning made to work on iOS WebKit via the `barcode-detector@^3.2.0`
polyfill (zxing-wasm, imported once at `main.tsx`, no-ops on Android Chrome where
the native API exists; the ~1 MiB wasm lazy-loads only where the polyfill runs);
snap-the-label and snap-the-front AI fallbacks with a mandatory editable review;
and the `health_foods` catalog itself. Two sub-decisions worth keeping: **lookups
only serve canonical or OFF/USDA-backfilled rows**, so one bad user submission
can't poison the catalog; and **every miss is stored** for a future
data-licensing play. **OFF write-back is deferred** — contributing our entries
upstream needs a bot account (repo issue #63, ConjureOS `OPEN_QUESTIONS.md`).

**CI migrate uses `supabase db push --include-all`** (2026-06-25,
DECISIONS_ARCHIVE:68). The prod health-foods apply failed because 091 merged to
main before 090 arrived, so `db push` refused the out-of-order 090.
`--include-all` applies anything not in the remote ledger regardless of file
order — safe because migrations are additive, idempotent and independent, and
this collision recurs whenever two branches add migrations in parallel. A
`workflow_dispatch` trigger was added so a stuck apply can be re-fired.

**Community food-DB writes authenticate with a *minted* ConjureOS identity
token, not the raw Supabase JWT** (2026-07-16, `DECISIONS.md`). Health's
scanned foods never reached the DB on mobile — the shell's hard rule keeps the
Supabase JWT out of the WebView, so `getAccessToken()` was null and the write
401'd silently (both dev and prod community DBs were verified empty). The call:
reuse the existing `mint-app-token` mechanism (the `recipes-db` precedent), not a
JWT leak and not a hardcoded first-party exception — the owner explicitly
rejected suppressing the consent prompt ("I'm not sure I want hard coded
exceptions to the rule out there"). The one-time consent gate stays, with an
honest first-party ConsentSheet variant ("Let ⟨app⟩ contribute as you?"). The
`identity.token()` bridge is **mobile-only**; desktop keeps `getAccessToken()`,
and the client feature-detects. Shipped at 1.5.1.

**Phase 45 — self-describing apps kills the fitness→recipes hardcoding**
(2026-07-14, `DECISIONS.md`). Fitness used to hardcode Recipes' action names,
`/apps/recipes`, and `recipe.nutrition.calories`. Now apps declare `needs` and
`provides` and the platform matches by shape. Two positions in that decision are
worth restating because they shape this app: **predefined named interfaces were
rejected** (tedious, almost always app-specific, won't be adopted by chance), and
**composition lives in apps** — `logRecipeMeal` is the cited example of a single
self-executing action, which is what lets the orchestrator stay a cheap
single-action router instead of an autonomous cross-app planner.

**Cross-app actions run a not-open provider in the BACKGROUND** (2026-07-17,
`DECISIONS.md`). Health's Search used to jump into Recipes fullscreen on mobile,
or fail with `TARGET_NOT_RUNNING` on desktop. Owner: "when one app is taking
action in another app I don't want to see that other app pop up at all". Both
platforms now warm the provider off-screen and answer the invoke without ever
showing a window.

**The stale-manifest fix** (2026-07-23). See `health-mobile-healthkit`.

**Health priming fires at Home, with a guided pre-prompt** (owner UX call,
2026-07-23). See `health-mobile-healthkit`.

**Plan editing is one surface, not two** (1.2.0, then reworked at 1.16.x). The
wizard and the cog were two disjoint edit surfaces; they were merged into
`planService.ts` as the single API for all plan reads/writes and reconciliation
(`loadPlan`, `commitNewPlan`, `updatePlan`, `saveProgram`,
`recordSessionAndAdapt`, `clearPlan`, `targetsToGoals`) — no screen calls
`savePlan` directly. Later, "Edit plan" was made to re-open the **wizard** and
the cog became prefs-only.

**The coach asks before it changes your plan** (1.11.0). The coach used to apply
an `<adjust>` silently. Now a program change is a `<propose>` rendered as
interactive chips + free text + "Leave it as is"; `<adjust>` only applies when
the user is answering. A cold `<adjust>` is converted into a confirm proposal, so
nothing changes unasked.

**Workout groups, not weeks** (1.13.x, `features/plan/groups.ts:1`). A program's
workouts are organised into numbered groups deliberately *not* called weeks:
there are no dates to fall behind on. You finish a group whenever you finish it,
then start the next.

**The weekly movement goal counts days, not sessions** (1.22.0,
`types.ts:510`). "Three times a week" is how people say it, and counting
sessions would double-count one effort whenever a wearable and a manual entry
both land — which they do, because `features/exercise.ts` adds them together on
purpose. A day counts when any exercise reached the calorie ring, so the goal and
the ring can never disagree.

**Stop judging the user's data for them** (1.23.1). The plausibility checker
added the day before was removed. See `health-food-lookup-chain`.

**The coach + workout pause** (2026-08-14). See `health-coach-pause-flag`. Note
this one is *not* in ConjureOS `DECISIONS.md`.

---

## health-status — Current status (dated)

> **Assessed 2026-08-21** against `origin/main` @ `eacf65f`, `package.json`
> `1.23.1`. The owner is actively finishing this app; treat anything here as
> stale after about a week.
>
> Corroborating signal, same date: ConjureOS `STATUS.md` "Next 3 things" lists
> **"1. Finish Conjure Health (Phase A). Almost done — nail the remaining v2
> work on the health/fitness anchor app. Mobile fixes as needed alongside."**
> This app is the platform's current top priority after the in-flight Jump
> Runner verification. Note that `ConjureOS` and `conjureos-mobile` are being
> edited concurrently, so line-number citations into them age fast. **Citation
> rule used throughout this doc:** every cross-repo reference carries either the
> quoted text or the symbol name beside the line number, so a drifted line is
> still findable with `grep`. Citations into *this* repo are plain line numbers
> against `eacf65f`.

### Shipped and working

- Nutrition logging end to end: diary with calorie ring + macro bars, per-meal
  detail, entry edit / move / delete, day navigation, recent-saved re-logging.
- Four ways to add food: barcode scan (with a freeze-on-detect scanner as of
  2026-08-17), text search, AI photo scan and AI text describe, and cross-app
  recipes.
- **Text search hits Open Food Facts + USDA only** (`foodSearch.ts:157`),
  US-biased, per-provider timeouts, progressive paint — **but materially
  degraded in every published build**: USDA runs on the shared `DEMO_KEY`
  (30 req/hr per IP) because CI never bakes `VITE_USDA_API_KEY`, and above the
  quota the whole-foods half of search silently returns nothing
  (conjureos-fitness#70). The community food DB is **barcode-only**:
  `conjureHealthDb.searchText()` (`conjureHealthDb.ts:162`) is written and the
  edge function's public `search` action is live, but nothing in `src/` calls
  it. See `health-food-lookup-chain`.
- The "Looks wrong?" correction flow, with corrections stored locally in
  `food-cache.json` and consulted ahead of every provider.
- Weight tracking: weigh-in, trend sparkline, BMI.
- The plan wizard and plan editor, `eat_better` mode, daily calorie + macro
  targets driving the diary rings, a manual targets override on the Plan tab,
  the weekly movement goal, and plan archiving.
- Apple Health / wearable exercise calories added back to the day's budget, with
  a per-day editable/removable "Completed today" list — **shipped in the app,
  but only reachable on a mobile build compiled with
  `EXPO_PUBLIC_CONJUREOS_HEALTH=1`, i.e. TestFlight/prod today.** Dev and
  preview clients report `unsupported` and show no wearable calories. See
  `health-mobile-healthkit`.
- Four cross-app actions (`logFood`, `todayTotals`, `logRecipeMeal`,
  `logWorkout`) and the `recipeSource` need via Phase 45 discovery.
- Settings: units toggle (instant-apply) and an itemized "Reset health data"
  including a working "Current plan" reset (fixed 1.22.0).
- The `health-foods-db` community catalog and the barcode-uniqueness fix
  (migration 100) — *shipped in the repo and recorded in the decision log as
  applied to dev and prod; not observable from here, see
  `health-backend-foods-db`.*

### Built but switched off

The AI coach, the adaptive workout program, the workout library and runner, the
benchmark/evaluation loop, and the evening check-in — all behind
`COACH_AND_WORKOUTS_ENABLED = false` since 2026-08-14. Code and tests intact;
data preserved. See `health-coach-pause-flag`.

### Not shipped despite being scoped

- **The daily check-off home (P3).** `markCheckoff` has no callers;
  `goalsCompleted` is never written. Do not describe this as working.
- **The "Tell coach" mid-session reprompt bar (P4).**
  `WorkoutSession.reprompts` is always `[]`.
- **Safety layer 3.** `features/safety/symptomKeywords.ts` is written, tested by
  nothing, and imported by nothing.
- **The `notify` permission (P5).** Not in the manifest; `notify` appears
  nowhere in `src/`.
- **The persistent coach disclaimer footer** (the third of layer 5's three
  surfaces).
- **Community-DB text search.** `conjureHealthDb.searchText()` and the edge
  function's public `search` action both exist; nothing in `src/` calls the
  client wrapper. The shared catalog is reachable by barcode only.
- **A re-Vite to `@conjureos/pack`.** Still Vite, deliberately.
- **OFF write-back.** We pull from Open Food Facts; we never push. Repo issue
  #63, blocked on a bot account.

### Open / pending

- **`conjure_project_url` Vault secret** must be set once per Supabase project
  (dev and prod) or the weekly moderation sweep no-ops. Everything else in the
  food DB works without it.
- **ConjureOS#573** (filed 2026-08-21) — `health-foods-db` is missing from
  `supabase/config.toml`, so it deploys with the CLI default
  `verify_jwt = true` despite its own header comment claiming the gateway check
  is off. If the gateway check really is on, the minted-token mobile write path
  is rejected before the function runs and the 1.5.1 fix is silently dead.
  **Verify against the deployed dev function before trusting mobile
  contributions.** See `health-backend-foods-db`.
- **conjureos-mobile#7** (filed 2026-08-21) — mobile health Gate 2 is wrapped in
  `if (ctx.grants)` and fails open. Latent, not live (the Runner always supplies
  it). See `health-mobile-healthkit`.
- **No Health-flagged dev build.** `EXPO_PUBLIC_CONJUREOS_HEALTH` is set only on
  the all-prod `testflight` profile, so the wearable path cannot be verified on
  a dev client. See `health-mobile-healthkit`.
- **AI, USDA and text-search lookups are not instrumented at all** — no client
  or server code path ever records an `ai_label` / `ai_front` / `usda` /
  `user_manual` outcome or a text query, so scan analytics cover barcodes only.
  (The separate auth gap on `logScanAttempt` is harmless: its three callers
  duplicate rows the server already writes.) See `health-backend-foods-db`.
- **ConjureOS#553** — reinstating some form of nutrition-data moderation
  (review queue, trust and rate limits, protecting upstream attribution from
  being overwritten). Deliberately filed separately after 1.23.1 removed the
  client-side plausibility check and auto-flagging.
- **Store version unknown.** The repo's `STATUS.md` last records
  publish state around 1.21.0 and its header was last updated 2026-08-04.
  Versions 1.22.0 / 1.23.0 / 1.23.1 all landed on 2026-08-19; **whether they have
  been published to the dev or prod store is not determinable from the repo** —
  check `store_apps` / the Actions run history before claiming either way.

### Documentation health (things that are wrong in-repo right now)

- **`README.md`** describes the pre-pause app: "run guided workouts with
  set/rest timers", "Workouts — built-in workout library with a guided player",
  three cross-app actions (there are four), and "`npm run typecheck` and
  `npm run build` are the CI gates" (there is no CI that runs them). It also
  still says "Calorie, nutrition, weight, and fitness tracking".
- **`STATUS.md`** is a long accreted document. Its header is dated 2026-08-04 at
  `1.21.0` while the code is at `1.23.1`; its lower sections still describe
  `0.2.10` and say "Conjure Health v2 … not started". Read the top few
  paragraphs and the git log; distrust the rest.
- **`.env.example`** header says "Conjure Fitness — environment configuration".
- **`src/features/foods/usda.ts:18-19`** says of `USING_DEMO_KEY`: *"The UI
  notes the degraded search."* It does not. `USING_DEMO_KEY` is defined at
  `usda.ts:20`, re-exported at `foodSearch.ts:193`, and has **zero** consumers —
  no screen or component reads it, so the DEMO_KEY degradation is completely
  invisible to the user. Pairs with conjureos-fitness#70.
- **The pause date is wrong in the code.** `src/features/flags.ts:11` says the
  coach/workout pause was decided **2026-08-04**, and repo `STATUS.md:3` is
  headed 2026-08-04 while describing `1.21.0` as the pause. Git disagrees: the
  pause is commit `7be6b56`, dated **2026-08-14**, and that is the commit where
  `package.json` becomes `1.21.0`. 2026-08-04 is the *previous* commit
  (`9e0a885`, the hygiene pass). This doc uses 2026-08-14 throughout. It matters
  because "If you are picking this up cold" below tells you to read `flags.ts`
  first — everything else in that comment is accurate, but the date is not.
- **`src/features/resetData.ts:6-8`** says the active plan is "Deliberately NOT
  touched", but `HISTORY_ITEMS` ships a `kind: "plan"` / "Current plan" row at
  `:29-31` that calls `repo.clearPlan()`. The doc comment predates the 1.22.0
  change that added the row and was never updated.
- **ConjureOS `STATUS.md:34`** describes 12b as "plan wizard + daily check-off
  home + AI workout coach" with no mention of the pause. (It is *correct* about
  the build path — the same sentence says "Fitness/Health + Finance still on
  Vite for now".)
- **ConjureOS `ANCHOR_APP_CI_SETUP.md:231-236`** states the `package.json` +
  `src/version.ts` two-place bump unscoped, which reads as applying to this app.
  It does not — see `health-build-publish`.
  `ConjureOS/docs/internal/ONBOARDING.md:993` already records the carve-out.
- **ConjureOS `DECISIONS.md`** has no entry for the 2026-08-14 coach/workout
  pause.

### If you are picking this up cold

1. Read `src/features/flags.ts` first — it explains more about the current
   product than the README does. **Its one error: the date.** It says the pause
   was decided 2026-08-04; the commit is 2026-08-14 (`7be6b56`, `1.21.0`).
   Everything else in that comment, including the revival checklist, is
   accurate.
2. `npm install && npm run typecheck && npm test` (90 tests as of 1.23.1).
3. `npm run dev` runs the whole app on mocks with zero configuration.
4. Bump `package.json` `version` before any push you intend to publish, and say
   the new number in your wrap-up.
