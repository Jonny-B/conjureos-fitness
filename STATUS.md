# Conjure Health, project status

> **Last updated: 2026-07-12. ACTIVE — relaunched + live in both stores; barcode/search UX merged to dev at `1.1.0`.**
> Development resumed and the app is back in the App Store on **dev** (version 2)
> and **prod** (fresh row `bfce8c94…`, featured, v1). Note: the dev `store_apps`
> row survived the pause (version-bump); the **prod** row had been deleted, so it
> was recreated via a first-publish. Current focus: Conjure Health v2.

## How the relaunch was published (2026-07-11)

CI's `workflow_dispatch` couldn't be triggered from the automation (GitHub App
can't dispatch Actions), and the prod row was missing (a plain Release would
have failed the version-bump path). So both stores were published via the
**sanctioned backdoor** (ANCHOR_APP_CI_SETUP.md → "Manual / backdoor publish"):
mint a bot token from the service-role key (`scripts/mint-bot-token.mjs`), then
`scripts/publish-app.mjs` with `PUBLISH_BOT_ACCESS_TOKEN` — dev as a version
bump, prod as `--first-publish --featured`. Now that the prod row exists again,
future publishes can go through normal CI (Release) with no bootstrap.

## Current focus

1. Un-pause docs + bump to `0.3.0` → shipped forward to `0.4.2` (done).
2. **Dev** App Store — **published** (version 2, 0.4.2).
3. **Prod** App Store — **published** (row `bfce8c94…`, featured, v1, 0.4.2).
4. Backend extras: `conjure_project_url` Vault secret (moderation email) + Open
   Food Facts push-back bot (issue #63).
5. **v2** (issues #57–62): plan wizard + daily check-off home + AI coach.
   - P0 (#57) domain model + Repository extension — **done** (mock v1→v2 migration,
     Supabase stubs throw `PLAN_REQUIRES_V2_BACKEND`).
   - P1 (#58) safety static assets — **done** (`src/features/safety/*` intake gate,
     injury exclusions, symptom keywords; `DisclaimerCard`).
   - P2 (#59) first-run wizard + plan-gen + validator + fallback — **done**
     (`src/screens/WizardScreen.tsx` + `src/features/plan/*`; App renders it when
     `getPlan()` is null; logging-only gate hides the Workouts tab). App at `0.5.0`.
   - P3 (#60) home + check-off — next · P4 (#61) AI coach · P5 (#62) settings + publish.

> Note: P2 lives on the branch only — **not published** to the stores yet (dev/prod
> are on `0.4.2`). The wizard gates the whole app on first run, so publish P3+ or a
> deliberate v2 cut, not this commit, unless you want testers to hit the wizard now.

Working branch: `claude/conjure-barcode-scanning-6y7f65`.

## What was already built (foundation, all shipped to dev + prod pre-pause)

The last pre-pause work made barcode scanning actually useful, then built a
community food database so misses get easier over time.

### Latest session — barcode scan UX + search fix (`0.5.0`)

- **One unified Scan surface.** Barcode scanning and the photo "scan the
  food/product" fallback now live on a single surface. The immersive scanner is
  primary; inline shortcuts (keyboard → manual barcode entry, camera → snap a
  photo) are always available, and a barcode miss still auto-surfaces the photo
  chooser. Branch: `claude/barcode-scan-ui-consolidate-q0w6i4`.
- **Immersive in-page scanner** (matches the MyFitnessPal-style reference):
  corner-bracket reticle, sweeping scan line, dimmed surround, framing guidance,
  and floating flashlight (torch via `applyConstraints`) / keyboard / camera
  controls — all while the mode tabs stay visible. No more full-screen takeover.
- **In-app camera for photo capture.** The nutrition-label and
  front-of-package captures now use a live in-app camera (`CameraCapture`,
  getUserMedia → canvas still) instead of the jarring OS camera that
  `<input capture>` launched. Falls back to a file/library picker when the
  camera is unavailable or denied.
- **Fixed "no hits" food search.** Text search fanned out to Open Food Facts +
  USDA with `Promise.all` and no timeout, so a slow/dead OFF request (its search
  endpoint is often slow or 503s) wedged the whole search — and a bad OFF draw
  plus a rate-limited USDA `DEMO_KEY` could yield zero. Now each provider is
  timed out (7s), results paint progressively as each lands (fast USDA no longer
  waits on OFF), and OFF sorts by scan popularity. "Milk" returns hits again.
- **Biased food search toward US (`0.5.1`).** USDA (a US database) is now the
  primary source — pulled at a higher share and front-loaded 2:1 in the merge
  (`mergeUsFirst`) — while OFF adds a `cc=us` + United-States country filter and
  drops results not tagged US. "Milk" now leads with real US USDA entries; OFF's
  noisy multi-country data still leaks a few branded items as the minority.

### What we accomplished (session before)

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
