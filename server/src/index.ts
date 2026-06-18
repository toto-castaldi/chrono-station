import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type {
  CreateExerciseBody,
  CreateTeamBody,
  LoginBody,
  SetExercisesBody,
  StartBody,
  UpdateExerciseBody,
  UpdateTeamBody,
} from '@shared/index';
import { clearSession, getUser, login, readUserId, setSession } from './auth.js';
import './db.js';
import { addClient, broadcastSnapshot, startTicker } from './sse.js';
import {
  HttpError,
  closeExercise,
  createExercise,
  createTeam,
  deleteExercise,
  deleteTeam,
  pause,
  reset,
  resume,
  setTeamExercises,
  snapshot,
  start,
  stop,
  undoExercise,
  updateExercise,
  updateTeam,
} from './store.js';

const app = Fastify({ logger: true });
// credentials: true necessario per inviare il cookie di sessione (origin:true riflette l'origine, mai '*')
await app.register(cors, { origin: true, credentials: true });
await app.register(cookie, {
  // in prod SESSION_SECRET è obbligatorio (vedi docker-compose.yml); fallback solo per dev
  secret: process.env.SESSION_SECRET || 'chrono-dev-session-secret-change-me',
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  app.log.error(err);
  return reply.code(500).send({ error: 'internal error' });
});

// ---- autenticazione: protegge tutto tranne health e login ----
app.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0];
  if (path === '/api/health' || path === '/api/auth/login') return;
  const userId = readUserId(req);
  if (userId === null) return reply.code(401).send({ error: 'non autenticato' });
  req.userId = userId;
});

app.post<{ Body: LoginBody }>('/api/auth/login', async (req, reply) => {
  const user = await login(req.body);
  setSession(reply, user.id);
  return { user };
});

app.post('/api/auth/logout', async (_req, reply) => {
  clearSession(reply);
  return { ok: true };
});

app.get('/api/auth/me', async (req) => {
  const user = await getUser(req.userId);
  if (!user) throw new HttpError(401, 'non autenticato');
  return { user };
});

// ---- letture ----
app.get('/api/health', async () => ({ ok: true }));
app.get('/api/workout', async (req) => snapshot(req.userId));
app.get('/api/exercises', async (req) => (await snapshot(req.userId)).exercises);

// ---- stream SSE ----
app.get('/api/stream', async (req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write('retry: 2000\n\n');
  await addClient(req.userId, reply.raw);
  reply.hijack();
});

// ---- onboarding ----
app.post<{ Body: CreateTeamBody }>('/api/teams', async (req) => {
  await createTeam(req.userId, req.body);
  await broadcastSnapshot(req.userId, 'state');
  return snapshot(req.userId);
});

app.patch<{ Params: { id: string }; Body: UpdateTeamBody }>('/api/teams/:id', async (req) => {
  await updateTeam(req.userId, Number(req.params.id), req.body);
  await broadcastSnapshot(req.userId, 'state');
  return snapshot(req.userId);
});

app.delete<{ Params: { id: string } }>('/api/teams/:id', async (req) => {
  await deleteTeam(req.userId, Number(req.params.id));
  await broadcastSnapshot(req.userId, 'state');
  return snapshot(req.userId);
});

app.put<{ Params: { id: string }; Body: SetExercisesBody }>(
  '/api/teams/:id/exercises',
  async (req) => {
    await setTeamExercises(req.userId, Number(req.params.id), req.body.exerciseIds);
    await broadcastSnapshot(req.userId, 'state');
    return snapshot(req.userId);
  },
);

// ---- censimento esercizi (catalogo per-utente) ----
app.post<{ Body: CreateExerciseBody }>('/api/exercises', async (req) => {
  await createExercise(req.userId, req.body);
  await broadcastSnapshot(req.userId, 'state');
  return snapshot(req.userId);
});

app.patch<{ Params: { id: string }; Body: UpdateExerciseBody }>(
  '/api/exercises/:id',
  async (req) => {
    await updateExercise(req.userId, Number(req.params.id), req.body);
    await broadcastSnapshot(req.userId, 'state');
    return snapshot(req.userId);
  },
);

app.delete<{ Params: { id: string } }>('/api/exercises/:id', async (req) => {
  await deleteExercise(req.userId, Number(req.params.id));
  await broadcastSnapshot(req.userId, 'state');
  return snapshot(req.userId);
});

// ---- controllo esecuzione ----
app.post<{ Body: StartBody }>('/api/workout/start', async (req) => {
  await start(req.userId, req.body?.countdownSecs);
  await broadcastSnapshot(req.userId, 'state');
  return snapshot(req.userId);
});

for (const [path, fn] of [
  ['pause', pause],
  ['resume', resume],
  ['stop', stop],
  ['reset', reset],
] as const) {
  app.post(`/api/workout/${path}`, async (req) => {
    await fn(req.userId);
    await broadcastSnapshot(req.userId, 'state');
    return snapshot(req.userId);
  });
}

// ---- esecuzione ----
app.post<{ Params: { id: string } }>('/api/teams/:id/close', async (req) => {
  await closeExercise(req.userId, Number(req.params.id));
  await broadcastSnapshot(req.userId, 'team');
  return snapshot(req.userId);
});

app.post<{ Params: { id: string } }>('/api/teams/:id/undo', async (req) => {
  await undoExercise(req.userId, Number(req.params.id));
  await broadcastSnapshot(req.userId, 'team');
  return snapshot(req.userId);
});

const ticker = startTicker();
const port = Number(process.env.PORT ?? 3000);
try {
  await app.listen({ host: '0.0.0.0', port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    clearInterval(ticker);
    app.close().then(() => process.exit(0));
  });
}
