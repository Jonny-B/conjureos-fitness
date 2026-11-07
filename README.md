# Conjure Fitness, an app for ConjureOS

> **Split from Conjure Health on 2026-09-28.** This repo is Conjure Fitness:
> guided workouts, run tracking, an adaptive training plan and an AI coach.
> Calorie and food tracking moved to Conjure Health, which lives in
> [conjureos-health](https://github.com/Jonny-B/conjureos-health) and publishes
> as its own listing, slug `health`.
>
> - Store slug `conjure-fitness`, this app's own listing. Never publish to
>   `fitness`: that is the old Conjure Health listing, withdrawn on 2026-10-22
>   when Health moved to `health`, and nothing may publish to it again.
> - Publishing (`.github/workflows/publish-store.yml`, shaped like Health's;
>   `src/publishWorkflow.test.ts` holds it): Actions → Run workflow publishes
>   to the DEV store by default, or to PROD with target `prod`; publishing a
>   GitHub release publishes to PROD. Bump `version` above the live one first.
> - The workflow ships a new version of an existing listing. The dev listing was
>   created by hand on 2026-09-28 (store app id
>   `57a80973-e0e2-4c75-97a2-cbe3691ee56e`, featured, v1 = `0.1.0`), so never
>   run `--first-publish` for `conjure-fitness` on dev again. The prod listing
>   was created by the workflow's own `first_publish` input (Run workflow with
>   target `prod` and the box ticked; off by default, refused if the listing
>   exists), which passes `first-publish`, the display name and `featured` to
>   the shared action. The dev step has no such input.
> - `src/features/flags.ts`: `COACH_AND_WORKOUTS_ENABLED` is on and
>   `NUTRITION_ENABLED` is off. The food code is still here, just unreachable;
>   the app opens on the Home screen (`src/screens/HomeScreen.tsx`).
> - No shared backend: the Supabase `fitness` schema is Health's, so this app
>   keeps its data in its local store (`src/data/repository.ts`).
> - Cross-app actions: `listWorkouts`, `trainingSummary`, `nextWorkout` and
>   `logWorkout`, documented in [ACTIONS.md](ACTIONS.md). `listWorkouts` feeds
>   Conjure Health's calorie ring through its `workoutSource` need; its
>   `returns` schema is a contract.

Guided workouts, run and ride tracking, an adaptive training plan and an AI
coach. A keystone (anchor) app for [ConjureOS](https://github.com/Jonny-B/ConjureOS),
built as a standalone Vite + React + TypeScript project and published to the App
Store as one self-contained HTML file. It is sealed (`appType: "sealed"`,
`editable: false`): the AI changes nothing in it.

## What's here today

The app opens on **Home** and has four tabs: Home, Plan, Coach and Workouts.

- **Home** (titled Today) — the plan's next workout, the plan's top goals, a
  box to ask the coach something, and the last five finished sessions.
- **Plan** — a wizard (disclaimer, safety intake, inputs, review) builds a plan
  from a goal in your own words. The AI writes the goals and then a workout
  program with benchmarks, checked against the movements your injuries rule out,
  with a built-in template as the fallback. The program runs in numbered groups,
  not weeks: group 1 of each cycle re-tests the benchmarks, the rest train, and
  finishing a group unlocks the next (the AI proposes a small progression). Every
  three logged sessions the adaptation pass proposes a small, validated change
  (reps, weight, rest, a swap or a deload). The safety intake puts anyone under
  18, pregnant or with a heart condition on a logging-only plan with no workouts.
  The tab also holds the program editor, the weight graph with a weigh-in, and
  the days-per-week goal.
- **Coach** — free-form chat, a check-in after a workout, and an evening "how
  did your day go?" banner (no notifications). It remembers what you tell it and
  can make small, validated changes to the plan. It lives in this tab only; it
  is not in ConjureOS Chat.
- **Workouts** — five built-in workouts (Full-Body Express, Core Finisher,
  Dumbbell Upper, Morning Run, Bike Ride) with a guided player (timed sets, rep
  sets, rest countdowns, audio cues), GPS runs and rides with distance, pace and
  splits, and a "Completed today" list. The list also holds exercise you add by
  hand and workouts synced from Apple Health or Health Connect (phone only),
  which you can correct or remove from the day without touching the source.
- **Settings** — units, the Consumer Health Data Privacy policy, withdrawing
  your agreement, and Reset health data.

Before it stores anything the app asks for your agreement to keep your health
data. That agreement also names what goes to the AI, and it gates every AI
feature: with none in force nothing is sent, and an answer that arrives after
you withdraw is thrown away (no coach chat, memory or plan change is saved from
it). Withdrawing takes you back to the agreement screen at once. The agreement
is the file `health-consent.json` in the app's VFS.

Calorie and food tracking is not part of this app: the Diary, Add food and
Journal code is still in the tree, switched off by `NUTRITION_ENABLED` and
unreachable.

## Architecture

Three layers, so a contributor can run everything locally:

- **`src/bridge/`** — thin wrappers over the ConjureOS host surface
  (`ai.complete`, VFS, cross-app actions, location, native health), each with a
  mock or a no-op outside ConjureOS so the app runs under `npm run dev`.
- **`src/data/`** — a single `Repository` interface. `MockRepository` is the
  store this app uses: `localStorage` is authoritative on each device, with a
  best-effort mirror in the VFS file `store.json`. `SupabaseRepository` is kept
  but switched off (see Backend below).
- **`src/features/`** + **`src/screens/`** — pure logic (plan and program
  generation, safety, coach, workout sequencing) and the React UI.

## Appearance

Conjure Fitness **inherits the ConjureOS theme + flavor** — whatever palette
and light/dark mode the OS is wearing, this app wears too, live. There is no
in-app override: no lock, no settings control.

`src/theme.ts` applies the OS appearance from the shim at boot (kills the
launch flash) and from every broadcast after, and exposes it through
`hostAppearance()`. No host (standalone / `npm run dev`) or no OS override
both fall back to the Conjure default + the browser's light/dark preference,
which `@conjureos/ui`'s tokens.css already treats as "no `data-theme`"/"no
`data-flavor`" — the correct behavior, not a missing case.

Never hardcode a colour. `--cui-on-accent` is dark in six of the nine
palettes, so `color: #fff` on a filled control is a bug. The camera and
scanner overlays are the exception: their white sits over a live video feed,
not over a themed surface. The macro/status palette
(`--protein`/`--carbs`/`--fat`/`--good`/`--bad`) and the timeline "kind"
palette (`--kind-*`, one colour per journal entry type) are also exceptions,
deliberately fixed rather than theme-following — see the comment at the top
of `src/styles.css`.

## Development

```bash
npm install
npm run dev
npm run typecheck && npm test && npm run build:inline   # before pushing
```

With no host the app runs on the local store, the AI answers from a canned
mock, and the VFS is in memory, so planning, workouts and the coach all work
end to end offline. The repo has no CI workflow besides the store publish, which
runs `npm run build:inline`.

### Backend

None. `src/data/supabaseRepository.ts` talks to the shared project's `fitness`
schema, which holds Conjure Health's data (one plan and one profile per user), so
`SHARED_BACKEND_ENABLED` in `src/data/repository.ts` is `false` and the Supabase
path can never be selected. The publish bundle bakes in no Supabase URL.
Everything stays in the local store, and the AI goes through ConjureOS's
`ai.complete`.

## Build

```bash
npm run build         # dist/: separate JS and CSS, what a ZIP import ingests
npm run build:inline  # dist/index.html, one self-contained file: what the store publish ships
```

## Cross-app integration

Conjure Fitness registers four actions that other apps and ConjureOS Chat can
call: `listWorkouts`, `trainingSummary`, `nextWorkout` and `logWorkout`. They
are documented in [ACTIONS.md](ACTIONS.md). `listWorkouts` is what Conjure
Health's `workoutSource` need matches, so workouts recorded here count on its
calorie ring. Every action refuses with `NEEDS_CONSENT` until you have given the
agreement to keep health data. This app calls no other app's actions today; the
Recipes bridge from the Health days sits behind `NUTRITION_ENABLED`.

## License

MIT — see [LICENSE](LICENSE).
