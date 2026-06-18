001. Il modello dati vive su PostgreSQL ed è multi-utente, un allenamento per utente (coerente con doc/01-architecture.md 004): ogni utente (`app_user`) ha al più una riga `workout` (`workout.user_id` UNIQUE), le proprie squadre e il proprio catalogo esercizi (`exercise.user_id`, censito in onboarding)

002. Schema definito **by code** con Liquibase, in changelog **YAML** versionati in `server/db/changelog/`: master `db.changelog-master.yml` che include i changeset in `changes/` (`001-initial-schema.yml`, `002-seed.yml`, `003-auth-multitenancy.yml`, `004-exercise-per-user.yml`). Le tabelle e i dati seed (catalogo esercizi) NON sono creati dal codice applicativo: sono changeset Liquibase. Il changeset `003` introduce `app_user`, fa migrare il `workout` da singleton globale (`CHECK (id = 1)`) a uno-per-utente (chiave `user_id`) e partiziona `team` per utente; non crea alcun utente (`app_user` parte vuota: gli utenti si creano a mano, dev e prod) ed elimina i dati del vecchio modello single-tenant (riga singleton `workout` ed eventuali squadre) che nel modello per-utente non avrebbero proprietario. Il changeset `004` rende anche il catalogo esercizi per-utente: aggiunge `exercise.user_id` (FK `app_user`) ed elimina gli esercizi seedati dal `002` (privi di proprietario) — il catalogo di ogni utente parte vuoto e si popola via censimento in onboarding. Per evolvere lo schema si aggiunge **sempre un nuovo changeset** (mai modificare quelli già rilasciati), così l'`update` è idempotente e tracciato in `databasechangelog`. Gli istanti/durate in epoch ms eccedono il range `INTEGER`: sono `BIGINT`. Lo schema risultante (in SQL, a scopo illustrativo — la definizione autoritativa è nel changelog YAML):

```sql
-- utenti dell'app: password cifrata bcrypt. Creati solo via seed/admin (doc/00 019).
CREATE TABLE app_user (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                -- hash bcrypt, mai la password in chiaro
  created_at    BIGINT NOT NULL               -- epoch ms
);

-- catalogo esercizi per-utente, censito in onboarding (vedi doc/03-exercises.md)
CREATE TABLE exercise (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,  -- partiziona il catalogo per utente
  name         TEXT NOT NULL,
  target_type  TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'reps' | 'distance'
  target_value INTEGER,                       -- es. 1000 (m) o 100 (reps); NULL se 'none'
  unit         TEXT                            -- es. 'm' | 'reps'; NULL se 'none'
);

-- allenamento per-utente (un solo workout per utente). Il server è l'orologio autoritativo (doc/01 007).
CREATE TABLE workout (
  user_id           BIGINT PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  state             TEXT NOT NULL,        -- 'onboarding'|'countdown'|'running'|'paused'|'finished'
  countdown_secs    INTEGER NOT NULL DEFAULT 10,
  countdown_ends_at BIGINT,               -- epoch ms: fine countdown / istante elapsed=0
  started_at        BIGINT,               -- epoch ms a cui corrisponde elapsed=0 (aggiornato alla ripresa)
  paused_elapsed_ms BIGINT,               -- elapsed congelato mentre in pausa; NULL se running
  finished_at       BIGINT
);

CREATE TABLE team (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,  -- partiziona le squadre per utente
  name     TEXT NOT NULL,
  color    TEXT NOT NULL,                 -- colore scelto, es. hex
  position INTEGER NOT NULL               -- ordine di visualizzazione delle corsie
);

CREATE TABLE team_member (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  name    TEXT NOT NULL
);

-- ordine esercizi scelto da una squadra in onboarding
CREATE TABLE team_exercise (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     BIGINT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  exercise_id BIGINT NOT NULL REFERENCES exercise(id),
  position    INTEGER NOT NULL,           -- 0-based, ordine nel circuito della squadra
  UNIQUE (team_id, position)
);

-- parziali registrati alla chiusura di un esercizio. Append-only: l'undo rimuove l'ultimo.
CREATE TABLE split (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id       BIGINT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,         -- posizione dell'esercizio chiuso (== team_exercise.position)
  cumulative_ms BIGINT NOT NULL,          -- tempo trascorso dallo Start al momento della chiusura
  recorded_at   BIGINT NOT NULL,          -- epoch ms
  UNIQUE (team_id, position)
);
```

I `BIGINT` arriverebbero dal driver `pg` come stringa: il server registra un type-parser per riportarli a `number` (i valori — ms epoch, durate — stanno dentro `Number.MAX_SAFE_INTEGER`).

002b. Partizionamento per utente e sessione (doc/01 014):
- ogni funzione dello store riceve lo `userId` (risolto dall'hook di autenticazione) e filtra per esso: il `workout` per `user_id`, le squadre per `team.user_id`; membri, ordine esercizi e `split` sono raggiunti solo tramite squadre dell'utente (`team_id IN (SELECT id FROM team WHERE user_id = $1)`). L'accesso a una squadra altrui restituisce 404 (ownership check)
- `getOrCreateWorkout(userId)`: il workout è creato on-demand al primo accesso con `INSERT ... ON CONFLICT (user_id) DO NOTHING` (la PK su `user_id` rende l'upsert sicuro anche in caso di race). Non esiste più una riga `workout` "sempre presente": il `reset` resta un `UPDATE` dello stato + `DELETE` delle squadre dell'utente
- sessione **stateless**: nessuna tabella di sessione. Lo `userId` viaggia in un cookie httpOnly firmato; la verifica è solo crittografica (HMAC col `SESSION_SECRET`). Login/verifica password con bcrypt (`bcryptjs`)

003. Calcolo del tempo (nessun contatore incrementato in loop, doc/01 007):
- in `running`: `elapsed_ms = now - started_at`
- in `paused`: `elapsed_ms = paused_elapsed_ms`
- alla pausa: `paused_elapsed_ms = now - started_at`; alla ripresa: `started_at = now - paused_elapsed_ms`, `paused_elapsed_ms = NULL`

004. Stato derivato di una squadra (non duplicato in tabella, calcolato dai `split`):
- esercizio corrente = `team_exercise` con `position = COUNT(split della squadra)`
- avanzamento = `COUNT(split) / COUNT(team_exercise)`
- squadra finita quando `COUNT(split) = COUNT(team_exercise)`; tempo totale = `cumulative_ms` dell'ultimo split (doc/00 012)

005. Undo (doc/00 017) = `DELETE` dello split con `position` massima per quella squadra: riapre l'esercizio corrente

006. Tipi TypeScript condivisi in `shared/` (riusati da client e server per coerenza end-to-end):

```ts
export type WorkoutState = 'onboarding' | 'countdown' | 'running' | 'paused' | 'finished';
export type TargetType = 'none' | 'reps' | 'distance';

export interface Exercise { id: number; name: string; targetType: TargetType; targetValue?: number; unit?: string; }
export interface TeamExerciseRef { exerciseId: number; position: number; }
export interface Split { position: number; cumulativeMs: number; }

export interface Team {
  id: number; name: string; color: string; position: number;
  members: string[];
  exercises: TeamExerciseRef[];   // ordine scelto in onboarding
}

// vista calcolata per il client (per-squadra), inviata negli snapshot
export interface TeamProgress {
  teamId: number; currentPosition: number; total: number;
  finished: boolean; totalMs?: number; splits: Split[];
}

// snapshot completo: ricostruisce qualunque pagina dopo un reload (doc/01 001)
export interface WorkoutSnapshot {
  state: WorkoutState;
  elapsedMs: number;
  countdownEndsAt?: number;     // epoch ms, presente in 'countdown'
  teams: Team[];
  progress: TeamProgress[];
  exercises: Exercise[];        // catalogo
}

// autenticazione (lo snapshot resta invariato: l'isolamento è lato server)
export interface User { id: number; username: string; }   // mai il password_hash
export interface LoginBody { username: string; password: string; }
export interface AuthResponse { user: User; }
```
