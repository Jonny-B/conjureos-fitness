# Conjure Fitness: cross-app actions

What other ConjureOS apps, and ConjureChat, can ask Conjure Fitness for. The
handlers are in `src/bridge/fitnessActions.ts`; the schemas the host checks are
the `conjureos.actions` block in `package.json`. This page explains them.

| Action | Kind | What it's for |
|---|---|---|
| [`listWorkouts`](#listworkouts) | read | The workouts the user recorded, with duration and calories |
| [`trainingSummary`](#trainingsummary) | read | One week at a glance: workouts, active days vs goal, minutes, kcal, km |
| [`nextWorkout`](#nextworkout) | read | The next workout in the training plan, with its sets |
| [`logWorkout`](#logworkout) | write | Record a workout done outside the app |

The first time another app calls any of these actions, read or write, ConjureOS
asks the user once (Allow once / Always / Block). Only the ConjureOS assistant
is exempt. A Block comes back as `PERMISSION_DENIED`, so callers should treat it
as an empty answer, and a caller's invoke timeout should cover the dialog. A
closed Conjure Fitness is started off-screen to answer.

## Rules that hold for every action

- **Answers come from this device.** Conjure Fitness keeps its data in its own
  local store (no shared backend), so another device may answer differently.
- **Wearable workouts are not included.** Sessions synced from Apple Health or
  Health Connect are left out of the read actions. Conjure Health reads Apple
  Health itself, so including them would count those workouts twice.
- **Reads never call AI.** A background read must not spend the user's credits,
  so missing calorie figures are estimated with a MET formula: bodyweight when
  the profile has one, about 6 kcal a minute otherwise. `caloriesEstimated` says
  when that happened.
- **Dates are `YYYY-MM-DD`** in the user's local calendar and must be real
  dates (`2026-02-30` is refused). Bad params reject with a plain message.

## listWorkouts

`{ from?, to?, limit? }` → `{ from, to, workouts: Workout[] }`, newest first
(by `date`, then `completedAt`).

- `to` defaults to today, `from` to 6 days before `to`. A range wider than 92
  days is cut to the most recent 92 (the answer's `from` says where it
  started). `limit` is 1–100, default 50.
- Each workout: `id`, `date`, `name`, `type` (`"strength"`, `"cardio"`, or the
  activity a caller logged, lowercase), `durationMin`, `caloriesBurned`,
  `caloriesEstimated`, `completedAt` (ISO), and `distanceKm` for runs and rides.
  A run's route is never included.

**This is a published contract.** ConjureOS matches other apps' `needs` against
this `returns` schema structurally, and the match fails closed: drop a field
from the item's `required` list, or narrow a type, and every consumer quietly
disconnects with no error anywhere. Conjure Health's `workoutSource` need
(requires `id`, `date`, `caloriesBurned`) feeds its calorie ring from this
action. Add fields freely; never remove or rename one. The contract test in
`src/bridge/fitnessActions.test.ts` pins the required list.

To check a change against Conjure Health with ConjureOS's own matcher:

```js
// npm i @conjureos/bridge, then node this file (as .mjs)
import { schemaSatisfies } from "@conjureos/bridge";
import { readFileSync } from "node:fs";
const fit = JSON.parse(readFileSync("conjureos-fitness/package.json", "utf8")).conjureos;
const health = JSON.parse(readFileSync("conjureos-health/package.json", "utf8")).conjureos;
const need = health.needs.find((n) => n.id === "workoutSource");
console.log(schemaSatisfies(fit.actions.listWorkouts.returns, need.shape)); // { ok: true }
```

## trainingSummary

`{ date? }` → the Monday-to-`date` week containing `date` (default today;
future dates are refused): `weekStart`, `through`, `workouts`, `activeDays`,
`activeDates`, `weeklyGoalDays` (the plan's days-per-week target, 0 when there
is none), `minutes`, `caloriesBurned`, `distanceKm`, `hasPlan`.

## nextWorkout

No params → `{ hasPlan, hasProgram, message, workout?, group?, groupDone?,
groupSize?, evaluation? }`.

- `message` is one line a caller can show or say as-is ("Next up: Full-Body
  Express (1 of 3 done in group 2).").
- `workout` is the first unfinished workout in the current group: `id`, `name`,
  `type` (`strength`, `run` or `bike`), `summary?`, `target?` (a run or ride's
  goal, e.g. `"5 km"`), and `exercises: { name, prescription }[]` where
  `prescription` reads like `"3 × 10 reps"` or `"4 × 45s"`.
- `workout` is absent when there is no plan, the plan has no program, or the
  current group is finished; `message` says which. `evaluation` is true when
  the group re-tests the plan's benchmarks.

## logWorkout

`{ durationMin, name?, type?, distanceKm?, calories?, date? }` →
`{ id, date, name, durationMin, caloriesBurned, caloriesEstimated }`.

- Only `durationMin` (1–600) is required. `type` is the activity (`running`,
  `cycling`, `yoga`, …, up to 40 characters) and names the workout when `name`
  (up to 60) is absent. `distanceKm` (0.01–500) records a run, ride or swim's
  distance. `date` defaults to today and cannot be in the future.
- Pass `calories` (0–5000) only when the user or a device states the number;
  otherwise the app estimates it and says so.
- The workout appears in Conjure Fitness's history and the read actions above,
  and so reaches Conjure Health's calorie ring through `listWorkouts`. Log it
  in one app, not both.

## Deliberately not exposed

- **Plan, goal and program writes.** A plan passes the safety intake and injury
  exclusions when it is built; a caller editing one would skip both.
- **The safety intake** (age band, pregnancy, heart condition, injuries),
  **coach memory** and **check-in answers**.
- **GPS routes.** Distance only.
- **Deletes and bulk clears.** Irreversible; no caller need outweighs an agent
  wiping someone's training history by mistake.

## Ideas not built yet

From the 2026-09-28 review, in rough order of value: `getWorkout` (one session
in full, with sets and PRs), `personalRecords` (best per exercise, plan
benchmarks), `listWorkoutLibrary`, `importWorkoutFromImage` (a whiteboard WOD
or program screenshot), the coach as a `chat` surface in ConjureChat, a
`startWorkout` deep-link intent, and reading food, weight and sleep from
Conjure Health's `dayNutrition` / `recentWellbeing` so the coach and the burn
estimate have them.
