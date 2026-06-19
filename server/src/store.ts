import type {
  CreateExerciseBody,
  CreateTeamBody,
  Exercise,
  TargetType,
  Team,
  TeamProgress,
  UpdateExerciseBody,
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

// Multitenancy: ogni utente ha un proprio workout (workout.user_id UNIQUE).
// Creato on-demand al primo accesso; l'upsert ON CONFLICT gestisce la race.
const getOrCreateWorkout = async (userId: number): Promise<WorkoutRow> => {
  await all(
    `INSERT INTO workout (user_id, state, countdown_secs)
       VALUES ($1, 'onboarding', 10)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  return (await get<WorkoutRow>('SELECT * FROM workout WHERE user_id = $1', [userId])) as WorkoutRow;
};

/** Il countdown è terminato → lo stato diventa running. Ritorna true se è cambiato. */
async function reconcile(userId: number): Promise<boolean> {
  const w = await getOrCreateWorkout(userId);
  if (w.state === 'countdown' && w.countdown_ends_at !== null && Date.now() >= w.countdown_ends_at) {
    await all("UPDATE workout SET state = 'running' WHERE user_id = $1", [userId]);
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
  has_image: boolean;
  image_version: number;
}

// Colonne esposte al client: MAI image_data (pesante e non serve nello snapshot).
const EXERCISE_COLS =
  'id, name, target_type, target_value, unit, (image_data IS NOT NULL) AS has_image, image_version';

function toExercise(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    name: r.name,
    targetType: r.target_type,
    targetValue: r.target_value ?? undefined,
    unit: r.unit ?? undefined,
    hasImage: r.has_image,
    imageVersion: r.image_version,
  };
}

// Il catalogo esercizi è per-utente: ogni operatore censisce i propri (doc/03).
async function listExercises(userId: number): Promise<Exercise[]> {
  const rows = await all<ExerciseRow>(
    `SELECT ${EXERCISE_COLS} FROM exercise WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows.map(toExercise);
}

interface TeamRow {
  id: number;
  name: string;
  color: string;
  position: number;
}

async function getTeamRow(userId: number, id: number): Promise<TeamRow> {
  // il vincolo su user_id rende l'accesso cross-utente un 404 (ownership check)
  const row = await get<TeamRow>('SELECT * FROM team WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!row) throw new HttpError(404, `team ${id} non trovata`);
  return row;
}

async function listTeams(userId: number): Promise<Team[]> {
  const teams = await all<TeamRow>('SELECT * FROM team WHERE user_id = $1 ORDER BY position', [
    userId,
  ]);
  const members = await all<{ team_id: number; name: string }>(
    `SELECT team_id, name FROM team_member
       WHERE team_id IN (SELECT id FROM team WHERE user_id = $1) ORDER BY id`,
    [userId],
  );
  const exercises = await all<{ team_id: number; exercise_id: number; position: number }>(
    `SELECT team_id, exercise_id, position FROM team_exercise
       WHERE team_id IN (SELECT id FROM team WHERE user_id = $1) ORDER BY position`,
    [userId],
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

function allTeamsFinished(progress: TeamProgress[]): boolean {
  return progress.length > 0 && progress.every((p) => p.finished);
}

export async function snapshot(userId: number): Promise<WorkoutSnapshot> {
  await reconcile(userId);
  const w = await getOrCreateWorkout(userId);
  const teams = await listTeams(userId);
  const splitRows = await all<{ team_id: number; position: number; cumulative_ms: number }>(
    `SELECT team_id, position, cumulative_ms FROM split
       WHERE team_id IN (SELECT id FROM team WHERE user_id = $1) ORDER BY position`,
    [userId],
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
    exercises: await listExercises(userId),
  };
}

/** Riconcilia il countdown senza costruire l'intero snapshot (usato dal tick SSE). */
export async function tickState(userId: number): Promise<{
  elapsedMs: number;
  state: WorkoutState;
  changed: boolean;
}> {
  const changed = await reconcile(userId);
  const w = await getOrCreateWorkout(userId);
  return { elapsedMs: elapsedMs(w), state: w.state, changed };
}

// ---- onboarding (solo in stato onboarding) ----

async function assertOnboarding(userId: number): Promise<void> {
  if ((await getOrCreateWorkout(userId)).state !== 'onboarding')
    throw new HttpError(409, 'modifica consentita solo in onboarding');
}

export async function createTeam(userId: number, body: CreateTeamBody): Promise<number> {
  await assertOnboarding(userId);
  // doc/00 018: nome e almeno un membro obbligatori; nome (case-insensitive) e colore univoci.
  const name = (body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'il nome squadra è obbligatorio');
  const members = (body.members ?? []).map((m) => m.trim()).filter(Boolean);
  if (members.length === 0) throw new HttpError(400, 'serve almeno un membro');
  const teams = await listTeams(userId);
  if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase()))
    throw new HttpError(409, `esiste già una squadra di nome "${name}"`);
  if (teams.some((t) => t.color === body.color))
    throw new HttpError(409, 'colore già usato da un\'altra squadra');
  const maxPos = await get<{ m: number | null }>(
    'SELECT MAX(position) AS m FROM team WHERE user_id = $1',
    [userId],
  );
  const pos = (maxPos?.m ?? -1) + 1;
  return tx(async (c) => {
    const { rows } = await c.query<{ id: number }>(
      'INSERT INTO team (name, color, position, user_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, body.color, pos, userId],
    );
    const teamId = rows[0].id;
    for (const m of members)
      await c.query('INSERT INTO team_member (team_id, name) VALUES ($1, $2)', [teamId, m]);
    return teamId;
  });
}

export async function updateTeam(userId: number, id: number, body: UpdateTeamBody): Promise<void> {
  await assertOnboarding(userId);
  await getTeamRow(userId, id);
  // doc/00 018: nome (case-insensitive) e colore restano univoci tra le squadre.
  const others = (await listTeams(userId)).filter((t) => t.id !== id);
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

export async function deleteTeam(userId: number, id: number): Promise<void> {
  await assertOnboarding(userId);
  await getTeamRow(userId, id);
  await all('DELETE FROM team WHERE id = $1', [id]);
}

export async function setTeamExercises(
  userId: number,
  id: number,
  exerciseIds: number[],
): Promise<void> {
  await assertOnboarding(userId);
  await getTeamRow(userId, id);
  const known = new Set((await listExercises(userId)).map((e) => e.id));
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

// ---- censimento esercizi (catalogo per-utente, solo in onboarding) ----

async function getExerciseRow(userId: number, id: number): Promise<ExerciseRow> {
  // come per le squadre: il filtro su user_id rende l'accesso cross-utente un 404
  const row = await get<ExerciseRow>(
    `SELECT ${EXERCISE_COLS} FROM exercise WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) throw new HttpError(404, `esercizio ${id} non trovato`);
  return row;
}

// L'obiettivo è opzionale (doc/03 002): se 'none' niente valore/unità; altrimenti
// valore intero > 0 e unità obbligatori. Ritorna i campi normalizzati per il DB.
function normalizeTarget(
  targetType: TargetType,
  targetValue: number | undefined,
  unit: string | undefined,
): { targetType: TargetType; targetValue: number | null; unit: string | null } {
  if (targetType !== 'none' && targetType !== 'reps' && targetType !== 'distance')
    throw new HttpError(400, 'tipo obiettivo non valido');
  if (targetType === 'none') return { targetType, targetValue: null, unit: null };
  if (targetValue === undefined || !Number.isInteger(targetValue) || targetValue <= 0)
    throw new HttpError(400, 'il valore obiettivo deve essere un intero positivo');
  const u = (unit ?? '').trim();
  if (!u) throw new HttpError(400, "l'unità dell'obiettivo è obbligatoria");
  return { targetType, targetValue, unit: u };
}

async function assertExerciseNameFree(
  userId: number,
  name: string,
  excludeId?: number,
): Promise<void> {
  // unicità case-insensitive del nome esercizio per utente (coerente con le squadre)
  const exists = (await listExercises(userId)).some(
    (e) => e.id !== excludeId && e.name.toLowerCase() === name.toLowerCase(),
  );
  if (exists) throw new HttpError(409, `esiste già un esercizio di nome "${name}"`);
}

export async function createExercise(userId: number, body: CreateExerciseBody): Promise<number> {
  await assertOnboarding(userId);
  const name = (body.name ?? '').trim();
  if (!name) throw new HttpError(400, "il nome dell'esercizio è obbligatorio");
  await assertExerciseNameFree(userId, name);
  const t = normalizeTarget(body.targetType, body.targetValue, body.unit);
  const row = await get<{ id: number }>(
    `INSERT INTO exercise (name, target_type, target_value, unit, user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, t.targetType, t.targetValue, t.unit, userId],
  );
  return row?.id ?? 0;
}

export async function updateExercise(
  userId: number,
  id: number,
  body: UpdateExerciseBody,
): Promise<void> {
  await assertOnboarding(userId);
  const cur = await getExerciseRow(userId, id);
  const name = body.name !== undefined ? body.name.trim() : cur.name;
  if (!name) throw new HttpError(400, "il nome dell'esercizio è obbligatorio");
  if (body.name !== undefined) await assertExerciseNameFree(userId, name, id);
  // ri-normalizza l'obiettivo combinando i campi forniti con quelli correnti
  const t = normalizeTarget(
    body.targetType ?? cur.target_type,
    body.targetValue !== undefined ? body.targetValue : (cur.target_value ?? undefined),
    body.unit !== undefined ? body.unit : (cur.unit ?? undefined),
  );
  await all('UPDATE exercise SET name = $1, target_type = $2, target_value = $3, unit = $4 WHERE id = $5', [
    name,
    t.targetType,
    t.targetValue,
    t.unit,
    id,
  ]);
}

export async function deleteExercise(userId: number, id: number): Promise<void> {
  await assertOnboarding(userId);
  await getExerciseRow(userId, id);
  const used = await get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM team_exercise WHERE exercise_id = $1',
    [id],
  );
  if ((used?.n ?? 0) > 0)
    throw new HttpError(409, 'esercizio usato da una o più squadre: rimuovilo prima dalle squadre');
  await all('DELETE FROM exercise WHERE id = $1', [id]);
}

// Immagine esercizio (doc/03 005): opzionale, byte come BYTEA nel DB.
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB dopo decodifica

// L'upload è una modifica del catalogo: consentito solo in onboarding (come create/update).
export async function setExerciseImage(
  userId: number,
  id: number,
  dataBase64: string,
  mime: string,
): Promise<void> {
  await assertOnboarding(userId);
  await getExerciseRow(userId, id); // ownership check (404 se non dell'utente)
  if (!ALLOWED_IMAGE_MIME.has(mime))
    throw new HttpError(400, 'formato immagine non supportato (jpeg, png o webp)');
  const data = Buffer.from(dataBase64 ?? '', 'base64');
  if (data.length === 0) throw new HttpError(400, 'immagine vuota o non valida');
  if (data.length > MAX_IMAGE_BYTES) throw new HttpError(400, 'immagine troppo grande (max 2 MB)');
  await all(
    'UPDATE exercise SET image_data = $1, image_mime = $2, image_version = image_version + 1 WHERE id = $3',
    [data, mime, id],
  );
}

export async function deleteExerciseImage(userId: number, id: number): Promise<void> {
  await assertOnboarding(userId);
  await getExerciseRow(userId, id);
  // image_version si incrementa comunque: invalida la cache del client che aveva l'immagine
  await all(
    'UPDATE exercise SET image_data = NULL, image_mime = NULL, image_version = image_version + 1 WHERE id = $1',
    [id],
  );
}

// Lettura dei byte: NON gated da onboarding — serve anche durante l'esecuzione.
export async function getExerciseImage(
  userId: number,
  id: number,
): Promise<{ data: Buffer; mime: string } | null> {
  const row = await get<{ image_data: Buffer | null; image_mime: string | null }>(
    'SELECT image_data, image_mime FROM exercise WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  if (!row || !row.image_data || !row.image_mime) return null;
  return { data: row.image_data, mime: row.image_mime };
}

// ---- controllo esecuzione ----

export async function start(userId: number, countdownSecs?: number): Promise<void> {
  const w = await getOrCreateWorkout(userId);
  if (w.state !== 'onboarding') throw new HttpError(409, 'start consentito solo da onboarding');
  const teams = await listTeams(userId);
  if (teams.length === 0) throw new HttpError(409, 'nessuna squadra registrata');
  if (teams.some((t) => t.exercises.length === 0))
    throw new HttpError(409, 'ogni squadra deve avere almeno un esercizio');
  const secs = countdownSecs ?? w.countdown_secs;
  const endsAt = Date.now() + secs * 1000;
  await all(
    `UPDATE workout
       SET state = 'countdown', countdown_secs = $1, countdown_ends_at = $2,
           started_at = $2, paused_elapsed_ms = NULL, finished_at = NULL
     WHERE user_id = $3`,
    [secs, endsAt, userId],
  );
}

export async function pause(userId: number): Promise<void> {
  await reconcile(userId);
  const w = await getOrCreateWorkout(userId);
  if (w.state !== 'running' || w.started_at === null)
    throw new HttpError(409, 'pausa consentita solo in running');
  await all("UPDATE workout SET state = 'paused', paused_elapsed_ms = $1 WHERE user_id = $2", [
    Date.now() - w.started_at,
    userId,
  ]);
}

export async function resume(userId: number): Promise<void> {
  const w = await getOrCreateWorkout(userId);
  if (w.state !== 'paused') throw new HttpError(409, 'ripresa consentita solo da paused');
  await all(
    "UPDATE workout SET state = 'running', started_at = $1, paused_elapsed_ms = NULL WHERE user_id = $2",
    [Date.now() - (w.paused_elapsed_ms ?? 0), userId],
  );
}

export async function stop(userId: number): Promise<void> {
  await reconcile(userId);
  const w = await getOrCreateWorkout(userId);
  if (w.state !== 'running' && w.state !== 'paused')
    throw new HttpError(409, 'stop consentito solo durante l\'esecuzione');
  const snap = await snapshot(userId);
  if (!allTeamsFinished(snap.progress))
    throw new HttpError(409, 'stop consentito solo quando tutte le squadre hanno finito il circuito');
  const elapsed = elapsedMs(w);
  await all(
    "UPDATE workout SET state = 'finished', paused_elapsed_ms = $1, finished_at = $2 WHERE user_id = $3",
    [elapsed, Date.now(), userId],
  );
}

export async function reset(userId: number): Promise<void> {
  await tx(async (c) => {
    await c.query('DELETE FROM team WHERE user_id = $1', [userId]); // cascade su membri/esercizi/split
    await c.query(
      `UPDATE workout SET state = 'onboarding', countdown_ends_at = NULL,
         started_at = NULL, paused_elapsed_ms = NULL, finished_at = NULL WHERE user_id = $1`,
      [userId],
    );
  });
}

// ---- esecuzione: chiusura esercizio / undo ----

export async function closeExercise(userId: number, teamId: number): Promise<void> {
  await reconcile(userId);
  const w = await getOrCreateWorkout(userId);
  if (w.state !== 'running' || w.started_at === null)
    throw new HttpError(409, 'chiusura consentita solo in running');
  const team = (await listTeams(userId)).find((t) => t.id === teamId);
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

export async function undoExercise(userId: number, teamId: number): Promise<void> {
  await getTeamRow(userId, teamId);
  const last = await get<{ p: number | null }>(
    'SELECT MAX(position) AS p FROM split WHERE team_id = $1',
    [teamId],
  );
  if (!last || last.p === null) throw new HttpError(409, 'nessuna chiusura da annullare');
  await all('DELETE FROM split WHERE team_id = $1 AND position = $2', [teamId, last.p]);
}
