import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH ?? './chrono.db';

// Bump quando cambia la FORMA dello schema. A ogni avvio, se la versione
// persistita nel DB è diversa, lo schema viene droppato e ricreato
// (doc/04-devops.md): nessuna migrazione dati, prod riparte pulito.
const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE exercise (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  target_type  TEXT NOT NULL DEFAULT 'none',
  target_value INTEGER,
  unit         TEXT
);

CREATE TABLE workout (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  state             TEXT NOT NULL,
  countdown_secs    INTEGER NOT NULL DEFAULT 10,
  countdown_ends_at INTEGER,
  started_at        INTEGER,
  paused_elapsed_ms INTEGER,
  finished_at       INTEGER
);

CREATE TABLE team (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  color    TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE team_member (
  id      INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  name    TEXT NOT NULL
);

CREATE TABLE team_exercise (
  id          INTEGER PRIMARY KEY,
  team_id     INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercise(id),
  position    INTEGER NOT NULL,
  UNIQUE (team_id, position)
);

CREATE TABLE split (
  id            INTEGER PRIMARY KEY,
  team_id       INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  cumulative_ms INTEGER NOT NULL,
  recorded_at   INTEGER NOT NULL,
  UNIQUE (team_id, position)
);
`;

const DROP = `
DROP TABLE IF EXISTS split;
DROP TABLE IF EXISTS team_exercise;
DROP TABLE IF EXISTS team_member;
DROP TABLE IF EXISTS team;
DROP TABLE IF EXISTS workout;
DROP TABLE IF EXISTS exercise;
`;

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;
if (currentVersion !== SCHEMA_VERSION) {
  // forma dello schema cambiata (o DB nuovo): drop e ricrea
  db.exec(DROP);
  db.exec(SCHEMA);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// catalogo placeholder (doc/03-exercises.md)
const SEED: Array<[string, string, number | null, string | null]> = [
  ['SkiErg', 'distance', 1000, 'm'],
  ['Sled Push', 'distance', 50, 'm'],
  ['Sled Pull', 'distance', 50, 'm'],
  ['Burpee Broad Jump', 'distance', 80, 'm'],
  ['Rowing', 'distance', 1000, 'm'],
  ['Farmers Carry', 'distance', 200, 'm'],
  ['Sandbag Lunges', 'distance', 100, 'm'],
  ['Wall Balls', 'reps', 100, 'reps'],
];

const exCount = (db.prepare('SELECT COUNT(*) AS n FROM exercise').get() as { n: number }).n;
if (exCount === 0) {
  const ins = db.prepare(
    'INSERT INTO exercise (name, target_type, target_value, unit) VALUES (?, ?, ?, ?)',
  );
  const tx = db.transaction(() => {
    for (const [name, type, value, unit] of SEED) ins.run(name, type, value, unit);
  });
  tx();
}

// garantisce la riga singleton del workout
db.prepare(
  `INSERT INTO workout (id, state, countdown_secs)
   VALUES (1, 'onboarding', 10)
   ON CONFLICT(id) DO NOTHING`,
).run();
