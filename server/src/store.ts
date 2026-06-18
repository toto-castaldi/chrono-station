import type {
  CreateTeamBody,
  Exercise,
  Team,
  TeamProgress,
  UpdateTeamBody,
  WorkoutSnapshot,
  WorkoutState,
} from '@shared/index';
import { all, get, tx } from './db.js';

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

const getWorkoutRow = async (): Promise<WorkoutRow> =>
  (await get<WorkoutRow>('SELECT * FROM workout WHERE id = 1')) as WorkoutRow;

/** Il countdown è terminato → lo stato diventa running. Ritorna true se è cambiato. */
async function reconcile(): Promise<boolean> {
  const w = await getWorkoutRow();
  if (w.state === 'countdown' && w.countdown_ends_at !== null && Date.now() >= w.countdown_ends_at) {
    await all("UPDATE workout SET state = 'running' WHERE id = 1");
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

interface ExerciseRow {
  id: number;
  name: string;
  target_type: Exercise['targetType'];
  target_value: number | null;
  unit: string | null;
}

async function listExercises(): Promise<Exercise[]> {
  const rows = await all<ExerciseRow>('SELECT * FROM exercise ORDER BY id');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    targetType: r.target_type,
    targetValue: r.target_value ?? undefined,
    unit: r.unit ?? undefined,
  }));
}

interface TeamRow {
  id: number;
  name: string;
  color: string;
  position: number;
}

async function getTeamRow(id: number): Promise<TeamRow> {
  const row = await get<TeamRow>('SELECT * FROM team WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `team ${id} non trovata`);
  return row;
}

async function listTeams(): Promise<Team[]> {
  const teams = await all<TeamRow>('SELECT * FROM team ORDER BY position');
  const members = await all<{ team_id: number; name: string }>(
    'SELECT team_id, name FROM team_member ORDER BY id',
  );
  const exercises = await all<{ team_id: number; exercise_id: number; position: number }>(
    'SELECT team_id, exercise_id, position FROM team_exercise ORDER BY position',
  );
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    position: t.position,
    members: members.filter((m) => m.team_id === t.id).map((m) => m.name),
    exercises: exercises
      .filter((e) => e.team_id === t.id)
      .map((e) => ({ exerciseId: e.exercise_id, position: e.position })),
  }));
}

function teamProgress(
  team: Team,
  splits: Array<{ position: number; cumulativeMs: number }>,
): TeamProgress {
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

export async function snapshot(): Promise<WorkoutSnapshot> {
  await reconcile();
  const w = await getWorkoutRow();
  const teams = await listTeams();
  const splitRows = await all<{ team_id: number; position: number; cumulative_ms: number }>(
    'SELECT team_id, position, cumulative_ms FROM split ORDER BY position',
  );
  const splitsByTeam = new Map<number, Array<{ position: number; cumulativeMs: number }>>();
  for (const s of splitRows) {
    const list = splitsByTeam.get(s.team_id) ?? [];
    list.push({ position: s.position, cumulativeMs: s.cumulative_ms });
    splitsByTeam.set(s.team_id, list);
  }
  return {
    state: w.state,
    elapsedMs: elapsedMs(w),
    countdownEndsAt: w.state === 'countdown' ? (w.countdown_ends_at ?? undefined) : undefined,
    teams,
    progress: teams.map((t) => teamProgress(t, splitsByTeam.get(t.id) ?? [])),
    exercises: await listExercises(),
  };
}

/** Riconcilia il countdown senza costruire l'intero snapshot (usato dal tick SSE). */
export async function tickState(): Promise<{
  elapsedMs: number;
  state: WorkoutState;
  changed: boolean;
}> {
  const changed = await reconcile();
  const w = await getWorkoutRow();
  return { elapsedMs: elapsedMs(w), state: w.state, changed };
}

// ---- onboarding (solo in stato onboarding) ----

async function assertOnboarding(): Promise<void> {
  if ((await getWorkoutRow()).state !== 'onboarding')
    throw new HttpError(409, 'modifica consentita solo in onboarding');
}

export async function createTeam(body: CreateTeamBody): Promise<number> {
  await assertOnboarding();
  // doc/00 018: nome e almeno un membro obbligatori; nome (case-insensitive) e colore univoci.
  const name = (body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'il nome squadra è obbligatorio');
  const members = (body.members ?? []).map((m) => m.trim()).filter(Boolean);
  if (members.length === 0) throw new HttpError(400, 'serve almeno un membro');
  const teams = await listTeams();
  if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase()))
    throw new HttpError(409, `esiste già una squadra di nome "${name}"`);
  if (teams.some((t) => t.color === body.color))
    throw new HttpError(409, 'colore già usato da un\'altra squadra');
  const maxPos = await get<{ m: number | null }>('SELECT MAX(position) AS m FROM team');
  const pos = (maxPos?.m ?? -1) + 1;
  return tx(async (c) => {
    const { rows } = await c.query<{ id: number }>(
      'INSERT INTO team (name, color, position) VALUES ($1, $2, $3) RETURNING id',
      [name, body.color, pos],
    );
    const teamId = rows[0].id;
    for (const m of members)
      await c.query('INSERT INTO team_member (team_id, name) VALUES ($1, $2)', [teamId, m]);
    return teamId;
  });
}

export async function updateTeam(id: number, body: UpdateTeamBody): Promise<void> {
  await assertOnboarding();
  await getTeamRow(id);
  // doc/00 018: nome (case-insensitive) e colore restano univoci tra le squadre.
  const others = (await listTeams()).filter((t) => t.id !== id);
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new HttpError(400, 'il nome squadra è obbligatorio');
    if (others.some((t) => t.name.toLowerCase() === name.toLowerCase()))
      throw new HttpError(409, `esiste già una squadra di nome "${name}"`);
  }
  if (body.color !== undefined && others.some((t) => t.color === body.color))
    throw new HttpError(409, 'colore già usato da un\'altra squadra');
  await tx(async (c) => {
    if (body.name !== undefined)
      await c.query('UPDATE team SET name = $1 WHERE id = $2', [body.name, id]);
    if (body.color !== undefined)
      await c.query('UPDATE team SET color = $1 WHERE id = $2', [body.color, id]);
    if (body.position !== undefined)
      await c.query('UPDATE team SET position = $1 WHERE id = $2', [body.position, id]);
    if (body.members !== undefined) {
      await c.query('DELETE FROM team_member WHERE team_id = $1', [id]);
      for (const m of body.members)
        await c.query('INSERT INTO team_member (team_id, name) VALUES ($1, $2)', [id, m]);
    }
  });
}

export async function deleteTeam(id: number): Promise<void> {
  await assertOnboarding();
  await getTeamRow(id);
  await all('DELETE FROM team WHERE id = $1', [id]);
}

export async function setTeamExercises(id: number, exerciseIds: number[]): Promise<void> {
  await assertOnboarding();
  await getTeamRow(id);
  const known = new Set((await listExercises()).map((e) => e.id));
  for (const exId of exerciseIds)
    if (!known.has(exId)) throw new HttpError(400, `esercizio ${exId} inesistente`);
  await tx(async (c) => {
    await c.query('DELETE FROM team_exercise WHERE team_id = $1', [id]);
    for (let pos = 0; pos < exerciseIds.length; pos++)
      await c.query(
        'INSERT INTO team_exercise (team_id, exercise_id, position) VALUES ($1, $2, $3)',
        [id, exerciseIds[pos], pos],
      );
  });
}

// ---- controllo esecuzione ----

export async function start(countdownSecs?: number): Promise<void> {
  const w = await getWorkoutRow();
  if (w.state !== 'onboarding') throw new HttpError(409, 'start consentito solo da onboarding');
  const teams = await listTeams();
  if (teams.length === 0) throw new HttpError(409, 'nessuna squadra registrata');
  if (teams.some((t) => t.exercises.length === 0))
    throw new HttpError(409, 'ogni squadra deve avere almeno un esercizio');
  const secs = countdownSecs ?? w.countdown_secs;
  const endsAt = Date.now() + secs * 1000;
  await all(
    `UPDATE workout
       SET state = 'countdown', countdown_secs = $1, countdown_ends_at = $2,
           started_at = $2, paused_elapsed_ms = NULL, finished_at = NULL
     WHERE id = 1`,
    [secs, endsAt],
  );
}

export async function pause(): Promise<void> {
  await reconcile();
  const w = await getWorkoutRow();
  if (w.state !== 'running' || w.started_at === null)
    throw new HttpError(409, 'pausa consentita solo in running');
  await all("UPDATE workout SET state = 'paused', paused_elapsed_ms = $1 WHERE id = 1", [
    Date.now() - w.started_at,
  ]);
}

export async function resume(): Promise<void> {
  const w = await getWorkoutRow();
  if (w.state !== 'paused') throw new HttpError(409, 'ripresa consentita solo da paused');
  await all(
    "UPDATE workout SET state = 'running', started_at = $1, paused_elapsed_ms = NULL WHERE id = 1",
    [Date.now() - (w.paused_elapsed_ms ?? 0)],
  );
}

export async function stop(): Promise<void> {
  await reconcile();
  const w = await getWorkoutRow();
  if (w.state !== 'running' && w.state !== 'paused')
    throw new HttpError(409, 'stop consentito solo durante l\'esecuzione');
  const elapsed = elapsedMs(w);
  await all("UPDATE workout SET state = 'finished', paused_elapsed_ms = $1, finished_at = $2 WHERE id = 1", [
    elapsed,
    Date.now(),
  ]);
}

export async function reset(): Promise<void> {
  await tx(async (c) => {
    await c.query('DELETE FROM team'); // cascade su membri/esercizi/split
    await c.query(
      `UPDATE workout SET state = 'onboarding', countdown_ends_at = NULL,
         started_at = NULL, paused_elapsed_ms = NULL, finished_at = NULL WHERE id = 1`,
    );
  });
}

// ---- esecuzione: chiusura esercizio / undo ----

export async function closeExercise(teamId: number): Promise<void> {
  await reconcile();
  const w = await getWorkoutRow();
  if (w.state !== 'running' || w.started_at === null)
    throw new HttpError(409, 'chiusura consentita solo in running');
  const team = (await listTeams()).find((t) => t.id === teamId);
  if (!team) throw new HttpError(404, `team ${teamId} non trovata`);
  const doneRow = await get<{ n: number }>('SELECT COUNT(*) AS n FROM split WHERE team_id = $1', [
    teamId,
  ]);
  const done = doneRow?.n ?? 0;
  if (done >= team.exercises.length) throw new HttpError(409, 'la squadra ha già finito');
  // registra sempre e solo la posizione successiva attesa (idempotenza sul doppio tap)
  await all(
    'INSERT INTO split (team_id, position, cumulative_ms, recorded_at) VALUES ($1, $2, $3, $4)',
    [teamId, done, Date.now() - w.started_at, Date.now()],
  );
}

export async function undoExercise(teamId: number): Promise<void> {
  await getTeamRow(teamId);
  const last = await get<{ p: number | null }>(
    'SELECT MAX(position) AS p FROM split WHERE team_id = $1',
    [teamId],
  );
  if (!last || last.p === null) throw new HttpError(409, 'nessuna chiusura da annullare');
  await all('DELETE FROM split WHERE team_id = $1 AND position = $2', [teamId, last.p]);
}
