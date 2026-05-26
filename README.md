# conjureos-fitness

Frontend for **ConjureOS Fitness** — the AI-native calorie tracker that doesn't
suck to log (ConjureOS Phase 12b). React + Vite + TypeScript.

The pitch: MyFitnessPal's stickiness ceiling is logging fatigue. Here you
describe a meal in plain language — *"chicken sandwich and a beer for lunch"* —
or snap a photo, and the AI turns it into structured entries with estimated
macros that you can adjust. Exercise logs the same way (*"30 min run at a
moderate pace"* → calories burned).

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in the SAME Supabase project as ConjureOS
npm run dev
```

Open http://localhost:5174 and sign in (magic link, password, or Google — the
same accounts as ConjureOS).

## What v1 does

- **Plain-language logging** — natural-language food/exercise → structured entries
- **Photo logging** — snap a meal, get estimated items + macros (multimodal)
- **Daily totals vs goals** — calorie ring (eaten − burned = net) + protein / carbs / fat bars
- **Inline adjust** — tap any entry to fix the name, quantity, or macros; estimates are never claimed as precise
- **Weekly history** — last 7 days of net calories against your goal, tap a bar to jump to that day
- **Editable goals** — set your daily calorie + macro targets

## Architecture

- **Auth + data** — Supabase, shared with ConjureOS (same project). Entries and
  goals live in `fitness_entries` / `fitness_goals`, RLS-scoped per user. The
  browser talks to Postgres directly with the anon key.
- **AI logging** — the `fitness-parse` Edge Function (in `conjureos-fitness-backend`)
  holds the Anthropic key server-side and returns structured entries via Claude
  tool-use. The browser never sees the key.

```
src/
  App.tsx                auth gate
  lib/supabase.ts        client (shared ConjureOS project)
  lib/api.ts             Supabase CRUD + fitness-parse call
  lib/macros.ts          daily totals
  hooks/useAuth.ts       session tracking
  components/            SignIn, Dashboard, DaySummary, LogInput,
                         EntryList, WeeklyChart, GoalsModal
```

## Env

Vite exposes `VITE_`-prefixed vars to the browser. Use the same values as
ConjureOS so auth is shared:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The Anthropic key is **not** here — it lives server-side in the Edge Function.
