001. Il modello dati vive su PostgreSQL ed è multi-utente, un allenamento per utente (coerente con doc/01-architecture.md 004): ogni utente (`app_user`) ha al più una riga `workout` (`workout.user_id` UNIQUE), le proprie squadre e il proprio catalogo esercizi (`exercise.user_id`, censito in onboarding)

002. Schema definito **by code** con Liquibase, in changelog **YAML** versionati in `server/db/changelog/`: master `db.changelog-master.yml` che include i changeset in `changes/` (`001-initial-schema.yml`, `002-seed.yml`, `003-auth-multitenancy.yml`, `004-exercise-per-user.yml`, `005-exercise-image.yml`, `006-team-pause.yml`). Le tabelle e i dati seed (catalogo esercizi) NON sono creati dal codice applicativo: sono changeset Liquibase. Il changeset `003` introduce `app_user`, fa migrare il `workout` da singleton globale (`CHECK (id = 1)`) a uno-per-utente (chiave `user_id`) e partiziona `team` per utente; non crea alcun utente (`app_user` parte vuota: gli utenti si creano a mano, dev e prod) ed elimina i dati del vecchio modello single-tenant (riga singleton `workout` ed eventuali squadre) che nel modello per-utente non avrebbero proprietario. Il changeset `004` rende anche il catalogo esercizi per-utente: aggiunge `exercise.user_id` (FK `app_user`) ed elimina gli esercizi seedati dal `002` (privi di proprietario) — il catalogo di ogni utente parte vuoto e si popola via censimento in onboarding. Il changeset `005` aggiunge l'immagine opzionale per esercizio (`image_data` BYTEA, `image_mime`, `image_version`): nuove colonne nullable, nessun impatto sugli esercizi esistenti. Il changeset `006` aggiunge la pausa per-squadra (`team.paused_accum_ms` con default `0`, `team.paused_at_elapsed` nullable): nuove colonne con default/nullable, nessun impatto sulle squadre esistenti. Per evolvere lo schema si aggiunge **sempre un nuovo changeset** (mai modificare quelli già rilasciati), così l'`update` è idempotente e tracciato in `databasechangelog`. Gli istanti/durate in epoch ms eccedono il range `INTEGER`: sono `BIGINT`. Lo schema risultante (in SQL, a scopo illustrativo — la definizione autoritativa è nel changelog YAML):

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
  unit         TEXT,                           -- es. 'm' | 'reps'; NULL se 'none'
  -- immagine opzionale (doc/03 005): i byte stanno nel DB ma NON nello snapshot SSE,
  -- si servono da GET /api/exercises/:id/image; image_version cresce a ogni upload (cache-busting)
  image_data    BYTEA,                         -- byte dell'immagine; NULL se assente
  image_mime    TEXT,                          -- 'image/jpeg' | 'image/png' | 'image/webp'; NULL se assente
  image_version INTEGER NOT NULL DEFAULT 0     -- 0 = nessuna immagine; ?v= per il cache-busting client
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
  position INTEGER NOT NULL,              -- ordine di visualizzazione delle corsie
  -- pausa per-squadra (changeset 006, doc/00 021): misurata in unità di elapsed GLOBALE
  paused_accum_ms   BIGINT NOT NULL DEFAULT 0,  -- somma degli intervalli già trascorsi in pausa individuale
  paused_at_elapsed BIGINT                      -- elapsed globale all'inizio della pausa corrente; NULL se non in pausa
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
  cumulative_ms BIGINT NOT NULL,          -- tempo ATTIVO della squadra dallo Start (al netto delle pause individuali)
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

003b. Pausa per-squadra (doc/00 021): il tempo della singola squadra è derivato dall'elapsed **globale**, così si compone automaticamente con la pausa globale (durante la quale `elapsed` è già congelato):
- `team_elapsed = elapsed - paused_accum_ms - live`, dove `live = (paused_at_elapsed !== NULL) ? elapsed - paused_at_elapsed : 0`
- alla pausa squadra: `paused_at_elapsed = elapsed`; alla ripresa: `paused_accum_ms += elapsed - paused_at_elapsed`, `paused_at_elapsed = NULL`
- alla chiusura di un esercizio lo split registra `cumulative_ms = team_elapsed` (non l'elapsed globale): i parziali escludono il tempo di pausa individuale. La chiusura è rifiutata mentre la squadra è in pausa
- start azzera in modo difensivo `paused_accum_ms`/`paused_at_elapsed` delle squadre; il `reset` le elimina con le squadre

003c. Falsa partenza (doc/00 022, `cancel`): transizione legale da `countdown`/`running`/`paused` a `onboarding`. A differenza di `reset` **non** elimina le squadre: in transazione cancella i `split` delle squadre dell'utente, azzera `paused_accum_ms`/`paused_at_elapsed` e riporta `workout` a `onboarding` (con `countdown_ends_at`/`started_at`/`paused_elapsed_ms`/`finished_at` a NULL). Squadre, membri, esercizi e ordini restano intatti

004. Stato derivato di una squadra (non duplicato in tabella, calcolato dai `split`):
- esercizio corrente = `team_exercise` con `position = COUNT(split della squadra)`
- avanzamento = `COUNT(split) / COUNT(team_exercise)`
- squadra finita quando `COUNT(split) = COUNT(team_exercise)`; tempo totale = `cumulative_ms` dell'ultimo split (doc/00 012)
- `paused` = `paused_at_elapsed IS NOT NULL` (la squadra ha il proprio contatore in pausa, doc/00 021)

005. Undo (doc/00 017) = `DELETE` dello split con `position` massima per quella squadra: riapre l'esercizio corrente

006. Tipi TypeScript condivisi in `shared/` (riusati da client e server per coerenza end-to-end):

```ts
export type WorkoutState = 'onboarding' | 'countdown' | 'running' | 'paused' | 'finished';
export type TargetType = 'none' | 'reps' | 'distance';

// hasImage/imageVersion descrivono l'immagine SENZA trasportarne i byte (che si scaricano
// da GET /api/exercises/:id/image?v=imageVersion). imageVersion = 0 ⇒ nessuna immagine.
export interface Exercise { id: number; name: string; targetType: TargetType; targetValue?: number; unit?: string; hasImage: boolean; imageVersion: number; }
export interface TeamExerciseRef { exerciseId: number; position: number; }
// upload immagine: il client ridimensiona/comprime e invia base64
export interface SetExerciseImageBody { dataBase64: string; mime: string; }
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
  paused: boolean;                // true se il contatore della sola squadra è in pausa (doc/00 021)
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
