# Conjure Health, an app for ConjureOS

> **ACTIVE (relaunched 2026-07-11).** Back in development and returning to the
> App Stores. See [STATUS.md](STATUS.md) for what shipped, what is in flight, and
> the current focus.

> Renamed from "Conjure Fitness" on 2026-06-24 as v2 (plan wizard + daily check-off home + AI workout coach) was scoped. Slug `fitness` + repo `conjureos-fitness` unchanged for now to avoid a disruptive App Store re-publish; revisit when v2 publishes.

Calorie, nutrition, weight, and fitness tracking. A My Net Diary-style daily
tracker: log food by search, barcode, or plain language; see calories + macros
against your goals; weigh in; and run guided workouts with set/rest timers.

A keystone (anchor) app for [ConjureOS](https://github.com/Jonny-B/ConjureOS),
built as a standalone Vite + React + TypeScript project and imported via the
Phase 8 bundler. **Open source app, private backend** — see below.

## What's here today

- **Diary** — daily food log grouped by meal, calorie ring + macro bars vs.
  goals, per-entry quantity stepping, day-to-day navigation.
- **Add food** — four ways to log:
  - **Search** Open Food Facts (branded) + USDA FoodData Central (whole foods).
  - **Scan** barcodes via the camera (`BarcodeDetector`), with manual entry as
    a fallback where the API isn't supported (iOS Safari / Firefox).
  - **Describe** what you ate in plain language → AI estimates structured
    entries you adjust.
  - **Recipes** — pull a saved recipe from the [Recipes app](https://github.com/Jonny-B/conjureos-app-recipes)
    (cross-app actions) and log its per-serving macros, marking it cooked.
- **Trends** — weight tracking with a trend sparkline + BMI.
- **Workouts** — built-in workout library with a guided player: timed sets,
  rep sets, rest countdowns, and synthesized audio cues.
- **Profile & goals** — Mifflin-St Jeor recommendation with manual override.

Nutrition logging is the fully-built core; weight and workouts are functional
first slices that will deepen (custom workouts, exercise history, calories
burned) in later passes.

## Architecture

Three layers, so a contributor can run everything locally and the backend can
swap without touching the UI:

- **`src/bridge/`** — thin wrappers over the ConjureOS host surface
  (`ai.complete`, VFS, cross-app actions, host auth), each with a dev mock so
  the app runs outside the OS.
- **`src/data/`** — a single `Repository` interface. A VFS-backed **mock**
  (default) and a **Supabase** implementation sit behind it, picked at runtime.
  Nothing above this line knows which backend is live.
- **`src/features/`** + **`src/screens/`** — pure logic (diary math, goals,
  food search, workout sequencing) and the React UI.

## Appearance

Conjure Health is **locked to Winter dark** and does not follow the ConjureOS
theme. Most of this app is a number against a target, and its charts, rings and
status bands are tuned against one ground; Winter's cool, low-chroma palette
leaves the warm end of the spectrum free for "over target", which is the one
signal that must never be ambiguous.

Locked does not mean deaf. `src/theme.ts` still receives the OS appearance
(from the shim at boot, and from every broadcast after) and exposes it through
`hostAppearance()`. It is simply never applied. To unlock later, that file
becomes the ladder the Recipes app has plus a settings control; nothing else in
the app reads `data-theme` directly.

Never hardcode a colour. `--cui-on-accent` is dark in six of the nine palettes,
so `color: #fff` on a filled control is a bug even while the app is pinned to
one of them. The camera and scanner overlays are the exception: their white
sits over a live video feed, not over a themed surface.

## Development

```bash
npm install
npm run dev
```

With no configuration the app runs entirely on the **mock data layer** (in
memory + the app's VFS scope), so logging, the diary, weight, and workouts all
work end-to-end offline. The AI, VFS, and cross-app bridges are mocked too.
`npm run typecheck` and `npm run build` are the CI gates.

### Backend (private)

The app uses a real backend only when (1) the shared ConjureOS Supabase
project's `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set, **and** (2)
ConjureOS hands the app the signed-in user's session token via its auth bridge.
The `fitness`-schema SQL + edge functions live in a **separate private repo**;
this app talks to them through `src/data/supabaseRepository.ts`. Single
sign-on (use whoever is signed into ConjureOS, no per-app login) depends on a
platform auth bridge in ConjureOS — until it ships, the app stays on the mock.

See `.env.example` for configuration.

## Import into ConjureOS

```bash
npm run build       # dist/ — ingested by the Phase 8 bundler on ZIP import
```

## Cross-app integration

Conjure Health registers actions other apps / the home orchestrator can call:

| Action | Scope | What it does |
|---|---|---|
| `logFood({ name, calories, protein?, carbs?, fat?, meal?, date? })` | write | Log a food to the diary |
| `todayTotals()` | read | Today's totals + goals + calories remaining |
| `logRecipeMeal({ slug, servings?, meal?, date? })` | write | Log a Recipes-app recipe by slug and mark it cooked |

It also consumes the Recipes app's `listRecipes` / `getRecipe` / `markCooked`.

## License

MIT — see [LICENSE](LICENSE).
