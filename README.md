# conjureos-fitness

Frontend for **ConjureOS Fitness** — the AI-native calorie tracker that doesn't
suck to log (ConjureOS Phase 12b). React + Vite + TypeScript.

The pitch: MyFitnessPal's stickiness ceiling is logging fatigue. Here you
describe a meal in plain language — *"chicken sandwich and a beer for lunch"* —
or snap a photo, and the AI turns it into structured entries with estimated
macros that you can adjust. Exercise logs the same way (*"30 min run at a
moderate pace"* → calories burned).

## Quick start (no backend needed)

```bash
npm install
npm run dev
```

Open http://localhost:5174. With no env configured the app runs in **demo
mode** — an in-browser mock backend with seeded data, fake auth (sign in with
anything), and offline macro estimates. No Supabase, no API key, no server.
This is the default contributor experience; the frontend is open source while
the production backend is closed.

State persists to `localStorage`; clear it to reset the demo.

## Running against the real backend

The production backend (in `conjureos-fitness-backend`) is closed source. To
point this app at it, set the **same Supabase project as ConjureOS** in
`.env.local`:

```bash
cp .env.example .env.local
# set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```

Now sign-in, data, and AI logging hit the real Supabase + Edge Function. Set
`VITE_USE_MOCK=true` to force demo mode back on even when those vars are set.

## What v1 does

- **Calorie budget** — remaining calories (`goal − food + exercise`) shown big in the ring
- **Meal slots** — food organized into Breakfast / Lunch / Dinner / Snacks; tap a slot to log into it
- **Plain-language logging** — natural-language food/exercise → structured entries
- **Photo logging** — snap a meal, get estimated items + macros (multimodal)
- **Macros vs goals** — protein / carbs / fat bars
- **Inline adjust** — tap any entry to fix the name, quantity, or macros; estimates are never claimed as precise
- **Weekly history** — last 7 days of net calories against your goal, tap a bar to jump to that day
- **Editable goals** — set your daily calorie + macro targets
- **Account + settings** — header avatar opens settings; installable PWA for iPhone home screen

## Architecture — the backend boundary

Everything the UI needs (auth + data + AI logging) is expressed through one
interface, **`FitnessBackend`** (`src/lib/backend/types.ts`). The app picks an
implementation of it once at startup and never knows which one it got:

- **`mock`** (`src/lib/backend/mock.ts`) — fully offline. Seeded data persisted
  to `localStorage`, fake auth, and a keyword-table macro estimator standing in
  for the AI. Zero dependencies, deterministic. Selected automatically when no
  Supabase env is present, or forced with `VITE_USE_MOCK=true`.
- **`supabase`** (`src/lib/backend/supabase.ts`) — the real backend. Supabase
  auth + Postgres (shared with ConjureOS, RLS-scoped per user) and the
  `fitness-parse` Edge Function, which holds the Anthropic key server-side and
  returns structured entries via Claude tool-use. The browser never sees the key.

To add your own backend, implement `FitnessBackend` and wire it into
`backend/index.ts` — nothing in `components/` or `hooks/` changes.

```
src/
  App.tsx                auth gate
  lib/
    api.ts               data-access facade (thin pass-through to the backend)
    date.ts              local-day helpers
    macros.ts            daily totals
    types.ts             Entry / Goals / DraftEntry
    backend/
      types.ts           the FitnessBackend interface — the API contract
      index.ts           selector (mock vs supabase)
      mock.ts            offline demo backend
      supabase.ts        real ConjureOS backend
  hooks/useAuth.ts       session tracking (via the backend)
  components/            SignIn, Dashboard, DaySummary, LogInput,
                         EntryList, WeeklyChart, GoalsModal
```

## Env

Vite exposes `VITE_`-prefixed vars to the browser. Use the same values as
ConjureOS so auth is shared:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The Anthropic key is **not** here — it lives server-side in the Edge Function.
