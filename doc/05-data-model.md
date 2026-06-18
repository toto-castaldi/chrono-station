001. Il modello dati vive su SQLite ed è single-workout: esiste una sola riga `workout` alla volta (coerente con doc/01-architecture.md 004)

002. Schema (indicativo):

```sql
-- catalogo esercizi (placeholder fisso, vedi doc/03-exercises.md)
CREATE TABLE exercise (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'reps' | 'distance'
  target_value INTEGER,                      -- es. 1000 (m) o 100 (reps); NULL se 'none'
  unit        TEXT                           -- es. 'm' | 'reps'; NULL se 'none'
);

-- allenamento corrente (singleton). Il server è l'orologio autoritativo (doc/01 007).
CREATE TABLE workout (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  state            TEXT NOT NULL,        -- 'onboarding'|'countdown'|'running'|'paused'|'finished'
  countdown_secs   INTEGER NOT NULL DEFAULT 10,
  countdown_ends_at INTEGER,            -- epoch ms: fine countdown / istante elapsed=0
  started_at       INTEGER,             -- epoch ms a cui corrisponde elapsed=0 (aggiornato alla ripresa)
  paused_elapsed_ms INTEGER,            -- elapsed congelato mentre in pausa; NULL se running
  finished_at      INTEGER
);

CREATE TABLE team (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,            -- colore scelto, es. hex
  position    INTEGER NOT NULL          -- ordine di visualizzazione delle corsie
);

CREATE TABLE team_member (
  id      INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  name    TEXT NOT NULL
);

-- ordine esercizi scelto da una squadra in onboarding
CREATE TABLE team_exercise (
  id          INTEGER PRIMARY KEY,
  team_id     INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercise(id),
  position    INTEGER NOT NULL,         -- 0-based, ordine nel circuito della squadra
  UNIQUE (team_id, position)
);

-- parziali registrati alla chiusura di un esercizio. Append-only: l'undo rimuove l'ultimo.
CREATE TABLE split (
  id            INTEGER PRIMARY KEY,
  team_id       INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,       -- posizione dell'esercizio chiuso (== team_exercise.position)
  cumulative_ms INTEGER NOT NULL,       -- tempo trascorso dallo Start al momento della chiusura
  recorded_at   INTEGER NOT NULL,       -- epoch ms
  UNIQUE (team_id, position)
);
```

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
```
