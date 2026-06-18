chrono-station
==============

Applicazione web con interfaccia per tablet per traccire i tempi in un circuito a stazioni (tipo Hyrox).

La specifica completa (requisiti, UI, architettura, modello dati, API, devops) è in [`doc/`](doc/).

## Sviluppo

Monorepo npm workspaces: `server/` (Node + Fastify + SQLite), `client/` (React + Vite), `shared/` (tipi TypeScript condivisi).

```bash
npm install            # installa tutti i workspace
npm run dev:server     # API Fastify su http://localhost:3000
npm run dev:client     # client Vite su http://localhost:5173 (proxy /api -> :3000)
```

Build di produzione: `npm run build`. Type-check: `npm run typecheck`.

## Deploy

Push su `main` → GitHub Actions builda le immagini, le pubblica su GHCR e aggiorna il
server Linux via SSH (`docker compose pull && up -d`). Stack in `docker-compose.yml`
(server + Caddy con HTTPS automatico). Vedi [`doc/04-devops.md`](doc/04-devops.md).
