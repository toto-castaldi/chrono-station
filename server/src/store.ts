import type {
  CreateTeamBody,
  Exercise,
  Team,
  TeamProgress,
  UpdateTeamBody,
  WorkoutSnapshot,
  WorkoutState,
} from '@shared/index';
import { db } from './db.js';

// Errore con status HTTP, usato per le transizioni non valide (409).
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface WorkoutRow {
  state: WorkoutState;
  countdown_secs: number;
  countdown_ends_at: number | null;
  started_at: number | null;
  paused_elapsed_ms: number | null;
  finished_at: number | null;
}

const getWorkoutRow = (): WorkoutRow =>
  db.prepare('SELECT * FROM workout WHERE id = 1').get() as WorkoutRow;

/** Il countdown è terminato → lo stato diventa running. Ritorna true se è cambiato. */
function reconcile(): boolean {
  const w = getWorkoutRow();
  if (w.state === 'countdown' && w.countdown_ends_at !== null && Date.now() >= w.countdown_ends_at) {
    db.prepare("UPDATE workout SET state = 'running' WHERE id = 1").run();
    return true;
  }
  return false;
}

function elapsedMs(w: WorkoutRow): number {
  if (w.state === 'running' && w.started_at !== null) return Date.now() - w.started_at;
  if (w.state === 'paused' || w.state === 'finished') return w.paused_elapsed_ms ?? 0;
  return 0; // onboarding / countdown
}

// ---- letture ----

function listExercises(): Exercise[] {
  const rows = db.prepare('SELECT * FROM exercise ORDER BY id').all() as Array<{
    id: number;
    name: string;
    target_type: Exercise['targetType'];
    target_value: number | null;
    unit: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    targetType: r.target_type,
    targetValue: r.target_value ?? undefined,
    unit: r.unit ?? undefined,
  }));
}

function getTeamRow(id: number): { id: number; name: string; color: string; position: number } {
  const row = db.prepare('SELECT * FROM team WHERE id = ?').get(id) as
    | { id: number; name: string; color: string; position: number }
    | undefined;
  if (!row) throw new HttpError(404, `team ${id} non trovata`);
  return row;
}

function listTeams(): Team[] {
  const teams = db.prepare('SELECT * FROM team ORDER BY position').all() as Array<{
    id: number;
    name: string;
    color: string;
    position: number;
  }>;
  const members = db.prepare('SELECT name FROM team_member WHERE team_id = ? ORDER BY id');
  const exercises = db.prepare(
    'SELECT exercise_id, position FROM team_exercise WHERE team_id = ? ORDER BY position',
  );
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    position: t.position,
    members: (members.all(t.id) as Array<{ name: string }>).map((m) => m.name),
    exercises: (exercises.all(t.id) as Array<{ exercise_id: number; position: number }>).map((e) => ({
      exerciseId: e.exercise_id,
      position: e.position,
    })),
  }));
}

function teamProgress(team: Team): TeamProgress {
  const splits = (
    db
      .prepare('SELECT position, cumulative_ms FROM split WHERE team_id = ? ORDER BY position')
      .all(team.id) as Array<{ position: number; cumulative_ms: number }>
  ).map((s) => ({ position: s.position, cumulativeMs: s.cumulative_ms }));
  const total = team.exercises.length;
  const currentPosition = splits.length;
  const finished = total > 0 && currentPosition >= total;
  return {
    teamId: team.id,
    currentPosition,
    total,
    finished,
    totalMs: finished ? splits[splits.length - 1].cumulativeMs : undefined,
    splits,
  };
}

export function snapshot(): WorkoutSnapshot {
  reconcile();
  const w = getWorkoutRow();
  const teams = listTeams();
  return {
    state: w.state,
    elapsedMs: elapsedMs(w),
    countdownEndsAt: w.state === 'countdown' ? (w.countdown_ends_at ?? undefined) : undefined,
    teams,
    progress: teams.map(teamProgress),
    exercises: listExercises(),
  };
}

/** Riconcilia il countdown senza costruire l'intero snapshot (usato dal tick SSE). */
export function tickState(): { elapsedMs: number; state: WorkoutState; changed: boolean } {
  const changed = reconcile();
  const w = getWorkoutRow();
  return { elapsedMs: elapsedMs(w), state: w.state, changed };
}

// ---- onboarding (solo in stato onboarding) ----

function assertOnboarding() {
  if (getWorkoutRow().state !== 'onboarding')
    throw new HttpError(409, 'modifica consentita solo in onboarding');
}

export function createTeam(body: CreateTeamBody): number {
  assertOnboarding();
  // doc/00 018: nome e almeno un membro obbligatori; nome (case-insensitive) e colore univoci.
  const name = (body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'il nome squadra è obbligatorio');
  const members = (body.members ?? []).map((m) => m.trim()).filter(Boolean);
  if (members.length === 0) throw new HttpError(400, 'serve almeno un membro');
  const teams = listTeams();
  if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase()))
    throw new HttpError(409, `esiste già una squadra di nome "${name}"`);
  if (teams.some((t) => t.color === body.color))
    throw new HttpError(409, 'colore già usato da un\'altra squadra');
  const pos =
    ((db.prepare('SELECT MAX(position) AS m FROM team').get() as { m: number | null }).m ?? -1) + 1;
  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO team (name, color, position) VALUES (?, ?, ?)')
      .run(name, body.color, pos);
    const teamId = Number(info.lastInsertRowid);
    const insMember = db.prepare('INSERT INTO team_member (team_id, name) VALUES (?, ?)');
    for (const m of members) insMember.run(teamId, m);
    return teamId;
  });
  return tx();
}

export function updateTeam(id: number, body: UpdateTeamBody): void {
  assertOnboarding();
  getTeamRow(id);
  // doc/00 018: nome (case-insensitive) e colore restano univoci tra le squadre.
  const others = listTeams().filter((t) => t.id !== id);
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new HttpError(400, 'il nome squadra è obbligatorio');
    if (others.some((t) => t.name.toLowerCase() === name.toLowerCase()))
      throw new HttpError(409, `esiste già una squadra di nome "${name}"`);
  }
  if (body.color !== undefined && others.some((t) => t.color === body.color))
    throw new HttpError(409, 'colore già usato da un\'altra squadra');
  const tx = db.transaction(() => {
    if (body.name !== undefined) db.prepare('UPDATE team SET name = ? WHERE id = ?').run(body.name, id);
    if (body.color !== undefined)
      db.prepare('UPDATE team SET color = ? WHERE id = ?').run(body.color, id);
    if (body.position !== undefined)
      db.prepare('UPDATE team SET position = ? WHERE id = ?').run(body.position, id);
    if (body.members !== undefined) {
      db.prepare('DELETE FROM team_member WHERE team_id = ?').run(id);
      const ins = db.prepare('INSERT INTO team_member (team_id, name) VALUES (?, ?)');
      for (const m of body.members) ins.run(id, m);
    }
  });
  tx();
}

export function deleteTeam(id: number): void {
  assertOnboarding();
  getTeamRow(id);
  db.prepare('DELETE FROM team WHERE id = ?').run(id);
}

export function setTeamExercises(id: number, exerciseIds: number[]): void {
  assertOnboarding();
  getTeamRow(id);
  const known = new Set(listExercises().map((e) => e.id));
  for (const exId of exerciseIds)
    if (!known.has(exId)) throw new HttpError(400, `esercizio ${exId} inesistente`);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM team_exercise WHERE team_id = ?').run(id);
    const ins = db.prepare(
      'INSERT INTO team_exercise (team_id, exercise_id, position) VALUES (?, ?, ?)',
    );
    exerciseIds.forEach((exId, pos) => ins.run(id, exId, pos));
  });
  tx();
}

// ---- controllo esecuzione ----

export function start(countdownSecs?: number): void {
  const w = getWorkoutRow();
  if (w.state !== 'onboarding') throw new HttpError(409, 'start consentito solo da onboarding');
  const teams = listTeams();
  if (teams.length === 0) throw new HttpError(409, 'nessuna squadra registrata');
  if (teams.some((t) => t.exercises.length === 0))
    throw new HttpError(409, 'ogni squadra deve avere almeno un esercizio');
  const secs = countdownSecs ?? w.countdown_secs;
  const endsAt = Date.now() + secs * 1000;
  db.prepare(
    `UPDATE workout
       SET state = 'countdown', countdown_secs = ?, countdown_ends_at = ?,
           started_at = ?, paused_elapsed_ms = NULL, finished_at = NULL
     WHERE id = 1`,
  ).run(secs, endsAt, endsAt);
}

export function pause(): void {
  reconcile();
  const w = getWorkoutRow();
  if (w.state !== 'running' || w.started_at === null)
    throw new HttpError(409, 'pausa consentita solo in running');
  db.prepare("UPDATE workout SET state = 'paused', paused_elapsed_ms = ? WHERE id = 1").run(
    Date.now() - w.started_at,
  );
}

export function resume(): void {
  const w = getWorkoutRow();
  if (w.state !== 'paused') throw new HttpError(409, 'ripresa consentita solo da paused');
  db.prepare(
    "UPDATE workout SET state = 'running', started_at = ?, paused_elapsed_ms = NULL WHERE id = 1",
  ).run(Date.now() - (w.paused_elapsed_ms ?? 0));
}

export function stop(): void {
  reconcile();
  const w = getWorkoutRow();
  if (w.state !== 'running' && w.state !== 'paused')
    throw new HttpError(409, 'stop consentito solo durante l\'esecuzione');
  const elapsed = elapsedMs(w);
  db.prepare(
    "UPDATE workout SET state = 'finished', paused_elapsed_ms = ?, finished_at = ? WHERE id = 1",
  ).run(elapsed, Date.now());
}

export function reset(): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM team').run(); // cascade su membri/esercizi/split
    db.prepare(
      `UPDATE workout SET state = 'onboarding', countdown_ends_at = NULL,
         started_at = NULL, paused_elapsed_ms = NULL, finished_at = NULL WHERE id = 1`,
    ).run();
  });
  tx();
}

// ---- esecuzione: chiusura esercizio / undo ----

export function closeExercise(teamId: number): void {
  reconcile();
  const w = getWorkoutRow();
  if (w.state !== 'running' || w.started_at === null)
    throw new HttpError(409, 'chiusura consentita solo in running');
  const team = listTeams().find((t) => t.id === teamId);
  if (!team) throw new HttpError(404, `team ${teamId} non trovata`);
  const done = (
    db.prepare('SELECT COUNT(*) AS n FROM split WHERE team_id = ?').get(teamId) as { n: number }
  ).n;
  if (done >= team.exercises.length) throw new HttpError(409, 'la squadra ha già finito');
  // registra sempre e solo la posizione successiva attesa (idempotenza sul doppio tap)
  db.prepare(
    'INSERT INTO split (team_id, position, cumulative_ms, recorded_at) VALUES (?, ?, ?, ?)',
  ).run(teamId, done, Date.now() - w.started_at, Date.now());
}

export function undoExercise(teamId: number): void {
  getTeamRow(teamId);
  const last = db
    .prepare('SELECT MAX(position) AS p FROM split WHERE team_id = ?')
    .get(teamId) as { p: number | null };
  if (last.p === null) throw new HttpError(409, 'nessuna chiusura da annullare');
  db.prepare('DELETE FROM split WHERE team_id = ? AND position = ?').run(teamId, last.p);
}
