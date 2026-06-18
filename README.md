chrono-station
==============

Applicazione web con interfaccia per tablet per traccire i tempi in un circuito a stazioni (tipo Hyrox).

La specifica completa (requisiti, UI, architettura, modello dati, API, devops) è in [`doc/`](doc/).

## Sviluppo

Monorepo npm workspaces: `server/` (Node + Fastify + PostgreSQL), `client/` (React + Vite), `shared/` (tipi TypeScript condivisi).

Serve Docker per il database (PostgreSQL) e per le migrazioni (Liquibase).

```bash
npm install            # installa tutti i workspace

npm run db:up          # avvia PostgreSQL su localhost:5432 (Docker)
npm run db:migrate     # applica/aggiorna lo schema con Liquibase
                       # ripeti dopo aver aggiunto changeset in server/db/changelog
npm run db:down        # ferma PostgreSQL (i dati restano nel volume Docker)

npm run dev:server     # API Fastify su http://localhost:3000
npm run dev:client     # client Vite su http://localhost:5173 (proxy /api -> :3000)
```

Il server si collega al DB via `DATABASE_URL` (default `postgres://chrono:chrono@localhost:5432/chrono`).

### Schema del database

Lo schema è definito **by code** con [Liquibase](https://www.liquibase.com/), nei changelog in
`server/db/changelog/` (master `db.changelog-master.yml` + changeset YAML in `changes/`). Per
modificarlo aggiungi **sempre un nuovo changeset** (mai editare quelli già rilasciati) e lancia
`npm run db:migrate`. Vedi [`doc/05-data-model.md`](doc/05-data-model.md).

Build di produzione: `npm run build`. Type-check: `npm run typecheck`.

## Deploy

Push su `main` → GitHub Actions builda le immagini (server, web, migrate), le pubblica su GHCR e
aggiorna il server Linux via SSH (`docker compose pull && up -d`). Stack in `docker-compose.yml`
(PostgreSQL + migrazione Liquibase all'avvio + server + Caddy con HTTPS automatico).
Vedi [`doc/04-devops.md`](doc/04-devops.md).
