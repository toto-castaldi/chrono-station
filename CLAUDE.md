# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`chrono-station` — tablet web app (landscape 16:9) to time a station-based fitness circuit (Hyrox-style). Single operator, one workout at a time. Teams (each with a color and its own exercise order) all run in parallel; the operator closes each team's current exercise with a tap, recording a cumulative partial time. Pages: onboarding → execution → results.

## Commands

npm workspaces monorepo: `client/` · `server/` · `shared/`.

- `npm install` (root) — install all workspaces
- `npm run dev:server` — Fastify API on :3000 (env: `DB_PATH`, `PORT`)
- `npm run dev:client` — Vite dev server on :5173 (proxies `/api` → :3000)
- `npm run build` — build server (tsup) + client (vite)
- `npm run typecheck` — `tsc --noEmit` on both
- `node server/dist/index.js` — run the built server

No automated test suite yet.

## Where the architecture lives

Stack, the non-negotiable constraints, data model, API/SSE contract and DevOps are all specified in `doc/` (see below) — treat those as the source of truth and keep them updated as the code evolves. Key code entry points:

- `server/src/store.ts` — state machine, authoritative time math (no incrementing loop: time is derived from a stored start instant)
- `server/src/sse.ts` — SSE client registry, snapshot broadcast, 1s ticker
- `server/src/db.ts` — schema + seed; **drops & recreates the DB when `SCHEMA_VERSION` changes**
- `client/src/lib/useWorkout.ts` — SSE subscription holding the authoritative snapshot
- `client/src/App.tsx` — page shown is driven by server `state` (reload-safe)

## Spec (source of truth)

The numbered docs in `doc/` are authoritative (in Italian — keep domain terms: squadra, esercizio, esecuzione):
- `00-requirements.md` — functional requirements & flow
- `01-architecture.md` — non-negotiable constraints + stack & architecture
- `02-ui.md` — per-page UI
- `03-exercises.md` — predefined exercise list (placeholder)
- `04-devops.md` — CI/CD pipeline & Docker Compose deploy
- `05-data-model.md` — SQLite schema, time math, shared TS types
- `06-api.md` — REST endpoints & SSE event contract
