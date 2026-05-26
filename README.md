# Conjure Fitness — an app for ConjureOS

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

Conjure Fitness registers actions other apps / the home orchestrator can call:

| Action | Scope | What it does |
|---|---|---|
| `logFood({ name, calories, protein?, carbs?, fat?, meal?, date? })` | write | Log a food to the diary |
| `todayTotals()` | read | Today's totals + goals + calories remaining |
| `logRecipeMeal({ slug, servings?, meal?, date? })` | write | Log a Recipes-app recipe by slug and mark it cooked |

It also consumes the Recipes app's `listRecipes` / `getRecipe` / `markCooked`.

## License

MIT — see [LICENSE](LICENSE).
