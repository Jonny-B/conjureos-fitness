# Conjure Fitness, an app for ConjureOS

Guided workouts, run tracking, an adaptive training plan and an AI coach.
Calorie and food tracking live in Conjure Health
([conjureos-health](https://github.com/Jonny-B/conjureos-health)), which counts
the workouts recorded here through this app's `listWorkouts` action.

A standalone Vite + React + TypeScript project, imported into
[ConjureOS](https://github.com/Jonny-B/ConjureOS) by the Phase 8 bundler.

## Publishing (DEV ONLY for now)

- Store slug `conjure-fitness`, its own listing. Never publish to `fitness`:
  that is Conjure Health's slug, and publishing there would replace Conjure
  Health for everyone who has it installed.
- Publishes to the DEV store only (Actions → Run workflow). There is no
  release/prod trigger yet. The dev listing was created 2026-09-28 (store app
  id `57a80973-e0e2-4c75-97a2-cbe3691ee56e`, featured, v1 = `0.1.0`), so never
  run `--first-publish` for `conjure-fitness` on dev again. Prod has no listing
  yet. Bump `version` above the live one before every Run workflow.

## What's here

- **Home**: your next workout, your plan, a coach launcher and recent
  sessions.
- **Plan**: a plan built from your goal in your own words (by the AI, with a
  known-safe starter template as the fallback). Workouts come in groups that
  unlock one after another; the first group is a benchmark that sets your
  starting numbers, and the program adapts every few sessions. The tab also
  shows benchmark progress and training days this week against the plan's
  target.
- **Workouts**: a library of ready-to-run workouts with a guided player (timed
  sets, rep sets, rest countdowns, audio cues), GPS run and ride tracking, and
  a "Completed today" list that combines in-app sessions with Apple Health
  workouts, each with its calories burned.
- **Coach**: chat with an AI trainer that sees your plan and workouts, asks
  before it changes your program, and learns from post-workout reflections and
  the evening check-in.
- **Safety**: an intake (age, pregnancy, a heart condition, injuries) that can
  turn the plan into one with no workouts; injury exclusions enforced on every
  generated or adapted program; and a red-flag symptom screen that answers
  before any coach model call.

## Architecture

Three layers, so a contributor can run everything locally:

- **`src/bridge/`**: thin wrappers over the ConjureOS host surface
  (`ai.complete`, VFS, cross-app actions, location, Apple Health), each with a
  dev fallback so the app runs outside the OS.
- **`src/data/`**: a single `Repository` interface over the on-device store
  (`MockRepository`: localStorage is authoritative, mirrored to the app's
  VFS). Nothing above this line touches storage directly.
- **`src/features/`** + **`src/screens/`**: pure logic (plan generation and
  validation, the adaptive program, the coach, burn estimates, workout
  sequencing) and the React UI.

## Appearance

Conjure Fitness **inherits the ConjureOS theme + flavor**: whatever palette
and light/dark mode the OS is wearing, this app wears too, live. There is no
in-app override.

`src/theme.ts` applies the OS appearance from the shim at boot (kills the
launch flash) and from every broadcast after, and exposes it through
`hostAppearance()`. No host (standalone / `npm run dev`) or no OS override
both fall back to the Conjure default + the browser's light/dark preference,
which `@conjureos/ui`'s tokens.css already treats as "no `data-theme`"/"no
`data-flavor`".

Never hardcode a colour. `--cui-on-accent` is dark in six of the nine
palettes, so `color: #fff` on a filled control is a bug. The status palette
(`--good`/`--bad`/`--warn`) is the one exception, deliberately fixed rather
than theme-following; see the comment at the top of `src/styles.css`.

## Development

```bash
npm install
npm run dev
```

The app runs entirely on its on-device store, so plans, workouts and the
coach's memory all work offline. Without a ConjureOS host the AI bridge
answers with an empty reply, so every AI flow takes its non-AI fallback.
`npm run typecheck`, `npm test` and `npm run build` are the CI gates.

## Import into ConjureOS

```bash
npm run build       # dist/ — ingested by the Phase 8 bundler on ZIP import
```

## Cross-app integration

Conjure Fitness registers actions other apps and the ConjureOS assistant can
call. [ACTIONS.md](ACTIONS.md) is the contract:

| Action | Scope | What it does |
|---|---|---|
| `listWorkouts({ from?, to?, limit? })` | read | Recorded workouts, newest first, with duration and calories |
| `trainingSummary({ date? })` | read | This week's workouts, active days, minutes, calories and distance |
| `nextWorkout()` | read | The next workout in the plan, with its exercises and sets |
| `logWorkout({ durationMin, name?, type?, distanceKm?, calories?, date? })` | write | Record a workout done outside the app |

`listWorkouts` feeds Conjure Health's calorie ring through its `workoutSource`
need, so its `returns` schema is a contract: add fields, never remove or
rename one.

## License

MIT — see [LICENSE](LICENSE).
