# Conjure Health, project status

> **Last updated: 2026-07-11. ACTIVE — relaunching.**
> Development resumed. The app is being re-published to the App Stores (dev
> first, then prod) and v2 work is starting. The `store_apps` rows were deleted
> during the pause, so the re-publish creates fresh listings (version history +
> install records start over). Current focus: relaunch + Conjure Health v2.

## Current focus

Bringing the app back to life. Order of operations this session:

1. Un-pause docs + bump to `0.3.0` (done).
2. Re-publish to the **dev** App Store, verify barcode scanning end-to-end
   (manual `workflow_dispatch` — the automation can't dispatch Actions).
3. Re-publish to **prod** via GitHub Release (needs a branch→`main` merge first).
4. Backend extras: `conjure_project_url` Vault secret (moderation email) + Open
   Food Facts push-back bot (issue #63).
5. **v2** (issues #57–62): plan wizard + daily check-off home + AI coach.
   - P0 (#57) domain model + Repository extension — **done** (mock v1→v2 migration,
     Supabase stubs throw `PLAN_REQUIRES_V2_BACKEND`).
   - P1 (#58) safety static assets — **done** (`src/features/safety/*` intake gate,
     injury exclusions, symptom keywords; `DisclaimerCard`).
   - P2 (#59) wizard + plan-gen + validator — next.
   - P3 (#60) home + check-off · P4 (#61) AI coach · P5 (#62) settings + publish.

Working branch: `claude/conjure-barcode-scanning-6y7f65`.

## What was already built (foundation, all shipped to dev + prod pre-pause)

The last pre-pause work made barcode scanning actually useful, then built a
community food database so misses get easier over time.

### What we accomplished (most recent session)

- **Renamed the app** from "Conjure Fitness" to "Conjure Health" everywhere it
  shows (display name, window title, brand text). The slug stayed `fitness` and
  the repo name stayed `conjureos-fitness` to avoid a disruptive store
  re-publish.
- **Fixed barcode scanning on iPhones.** It was silently broken on iOS Safari
  and iOS Edge (no native `BarcodeDetector`). Added the `barcode-detector`
  polyfill so the camera scanner works on every phone; Android keeps using the
  faster native path.
- **Added a fallback when a barcode is not found.** Two ways to snap a photo:
  the nutrition label (most accurate) or the front of the package (for beer,
  produce, or anything without a label). AI reads the photo and fills in the
  nutrition.
- **You review the AI guess before saving.** A clean editable screen shows the
  AI's numbers with a friendly "double-check this" warning; every macro and
  micro is correctable before it saves.
- **Built a community food database** (lives in ConjureOS Supabase). Saved foods
  go into `health_foods` so the next person who scans the same barcode gets an
  instant hit. On a miss we check Open Food Facts and copy their answer into
  ours automatically.
- **Protected the database from bad data.** New user submissions stay hidden
  from lookups until trusted (canonical or sourced from Open Food Facts), so one
  bad entry cannot poison results for everyone.
- **Set up hands-off moderation.** A weekly job emails conjureos@gmail.com a
  short report if anyone looks like they are spamming or piling up flagged
  entries. Quiet weeks send nothing.
- **Shipped all of it to production**, app and backend. Fixed a deploy ordering
  snag along the way and made the fix permanent.

### What was already built before that (v1, the foundation)

- Diary with a calorie ring + macro bars vs. goals, day-to-day navigation.
- Add food four ways: text search (Open Food Facts + USDA), barcode scan,
  plain-language describe (AI), and pull a recipe from the Recipes app.
- Weight tracking with a trend sparkline + BMI.
- Built-in workout library with a guided player (timed sets, rep sets, rest
  timers, audio cues).
- Profile + goals via Mifflin-St Jeor with manual override.
- Clean data layer: a `Repository` interface with a VFS-backed mock (default)
  and a Supabase implementation, swappable at runtime.

## Where it lives

- **Frontend:** this repo (`conjureos-fitness`), Vite + React + TypeScript.
  Current version `0.2.10`.
- **Community food DB backend:** in the ConjureOS repo, NOT here. Migrations
  `090_health_foods.sql` + `092_health_foods_moderation.sql`, edge functions
  `health-foods-db` + `health-foods-moderation-sweep`. Live on dev + prod.
- **The original per-user backend** (diary/weight sync) was always a separate
  private repo and is still optional; the app runs fully on the mock layer
  without it.

## Pending when we resume

- **Conjure Health v2 (the big one, not started):** plan wizard + daily
  check-off home + AI workout coach. Designed and scoped into 6 GitHub issues on
  this repo (P0 through P5, issues #57 to #62). See the ConjureOS
  `PHASE_12_DESIGN.md` section 12b and `DECISIONS.md` 2026-06-24 for the full
  plan. v2 plan data is meant to persist as VFS app data.
- **Two small manual steps for the food DB** (only matter when resumed and only
  if we want the extras, the core works without them):
  - Set the `conjure_project_url` Vault secret on the dev and prod Supabase
    projects so the weekly moderation email actually fires (it no-ops until
    then). See ConjureOS `OPEN_QUESTIONS.md`.
  - Create an Open Food Facts bot account so we can contribute our entries back
    upstream (currently we only pull from OFF, we do not push). See ConjureOS
    `OPEN_QUESTIONS.md` and repo issue #63.

## To put it back in the stores

Nothing is deleted from the code. Re-publish via the normal flow:

- **Dev:** Actions, "Publish to ConjureOS App Store", Run workflow
  (`workflow_dispatch`).
- **Prod:** publish a GitHub Release (the release-published trigger ships to the
  prod project).

Bump the version in `package.json` first. The publish creates a fresh
`store_apps` row, so the app comes back as a new listing.
