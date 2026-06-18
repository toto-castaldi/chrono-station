# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Greenfield: only requirements docs (`doc/`) and a README — no source committed yet. Stack is decided (below) but **not yet scaffolded**: there is no build/lint/test command. First implementation task is to scaffold the monorepo, then document the resulting commands here.

## Stack & structure

- **Server** (authoritative): Node.js + TypeScript (Fastify) + SQLite. Holds all workout state; is the only clock.
- **Client**: React + Vite + TypeScript SPA.
- **Realtime**: SSE server→client for time + state events; operator actions are REST calls, each persisted to SQLite before being reflected on the stream.
- **Monorepo**: `client/` · `server/` · `shared/` (shared TS types: team, exercise, workout state, events).
- **Deploy**: single Linux host running everything via Docker Compose (server + Caddy reverse proxy serving the static client, auto-HTTPS). State is in-process, one workout — no horizontal scaling. SQLite lives on a persistent volume.
- **CI/CD**: push to `main` → GitHub Actions builds images, publishes to GHCR, then SSHes to the host and runs `docker compose pull && up -d` (no build in prod). Caddy must not buffer SSE (immediate flush).

## What this is

`chrono-station` — tablet web app (landscape 16:9) to time a station-based fitness circuit (Hyrox-style). Single operator, one workout at a time. Teams (each with a color and its own exercise order) all run in parallel; the operator closes each team's current exercise with a tap, recording a cumulative partial time. Pages: onboarding → execution → results.

## Architectural constraints (non-negotiable — from `doc/01-architecture.md`)

1. **All workout state lives server-side.** Reload, tablet crash, or stray client interaction must not lose in-progress data. Client is a thin view — not the source of truth.
2. **The client streams elapsed time from the server** (favor SSE/WebSocket); the server is the authoritative clock.
3. **Each exercise close persists a partial time server-side** at that moment.
4. **Single-user, single-workout** — no multi-tenancy/concurrency.

## Spec

The numbered docs in `doc/` are the source of truth (in Italian — keep domain terms: squadra, esercizio, esecuzione). Consult and keep them updated as requirements evolve:
- `00-requirements.md` — functional requirements & flow
- `01-architecture.md` — the hard constraints above
- `02-ui.md` — per-page UI
- `03-exercises.md` — predefined exercise list (placeholder)
- `04-devops.md` — CI/CD pipeline & Docker Compose deploy
