# Conjure Fitness: instructions for Claude

A ConjureOS anchor app, in its own repo. Project status is in `STATUS.md`.

## App type

Sealed (ConjureOS Phase 62): the AI changes nothing in this app. `package.json`
declares `"appType": "sealed"` plus `"editable": false`, the mirror older
clients read. Never drop either key: a manifest that declares no type is read
as an AI-editable applet. Do not add `editStyle`; the store and the kernel write
the legacy keys themselves. `src/appType.test.ts` holds all three.

## Versioning

`package.json` is the only place the version lives (`vite.config.ts` injects it
as `__APP_VERSION__`). Bump it with `npm install --package-lock-only` so the
lockfile follows, and take the number at push time, after a fetch.

## Before pushing

```
npm run typecheck && npm test && npm run build:inline
```

## Every AI request goes through the gate

`completeUnderAgreement` in `src/features/aiGate.ts` is the one place a request
leaves for the AI. Nothing is sent without the agreement to keep health data
(the one whose wording names what goes to the AI), and an answer that lands
after a withdrawal keeps nothing: no coach chat, memory, plan or program
change. Never import `complete` from `src/bridge/ai.ts`
anywhere else; `src/features/aiAgreement.test.ts` fails if a module does.
Capable-tier calls keep `maxTokens` at or above `CAPABLE_MIN_MAX_TOKENS`
(`src/bridge/capableCaps.test.ts`).

## Publishing

The store slug is `conjure-fitness`; never publish to `fitness`, a withdrawn
listing (Conjure Health's old one). `src/publishWorkflow.test.ts` holds the slug
and the shape of the dev and prod steps in `.github/workflows/publish-store.yml`.

A push to `dev` or `main` publishes nothing. The store changes only when the
"Publish to ConjureOS App Store" workflow runs: a hand dispatch (dev by default,
target `prod` for prod) or a published release, which goes to prod.
