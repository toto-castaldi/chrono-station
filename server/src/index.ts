import cors from '@fastify/cors';
import Fastify from 'fastify';
import type {
  CreateTeamBody,
  SetExercisesBody,
  StartBody,
  UpdateTeamBody,
} from '@shared/index';
import './db.js';
import { addClient, broadcastSnapshot, startTicker } from './sse.js';
import {
  HttpError,
  closeExercise,
  createTeam,
  deleteTeam,
  pause,
  reset,
  resume,
  setTeamExercises,
  snapshot,
  start,
  stop,
  undoExercise,
  updateTeam,
} from './store.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  app.log.error(err);
  return reply.code(500).send({ error: 'internal error' });
});

// ---- letture ----
app.get('/api/health', async () => ({ ok: true }));
app.get('/api/workout', async () => snapshot());
app.get('/api/exercises', async () => snapshot().exercises);

// ---- stream SSE ----
app.get('/api/stream', (_req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write('retry: 2000\n\n');
  addClient(reply.raw);
  reply.hijack();
});

// ---- onboarding ----
app.post<{ Body: CreateTeamBody }>('/api/teams', async (req) => {
  createTeam(req.body);
  broadcastSnapshot('state');
  return snapshot();
});

app.patch<{ Params: { id: string }; Body: UpdateTeamBody }>('/api/teams/:id', async (req) => {
  updateTeam(Number(req.params.id), req.body);
  broadcastSnapshot('state');
  return snapshot();
});

app.delete<{ Params: { id: string } }>('/api/teams/:id', async (req) => {
  deleteTeam(Number(req.params.id));
  broadcastSnapshot('state');
  return snapshot();
});

app.put<{ Params: { id: string }; Body: SetExercisesBody }>(
  '/api/teams/:id/exercises',
  async (req) => {
    setTeamExercises(Number(req.params.id), req.body.exerciseIds);
    broadcastSnapshot('state');
    return snapshot();
  },
);

// ---- controllo esecuzione ----
app.post<{ Body: StartBody }>('/api/workout/start', async (req) => {
  start(req.body?.countdownSecs);
  broadcastSnapshot('state');
  return snapshot();
});

for (const [path, fn] of [
  ['pause', pause],
  ['resume', resume],
  ['stop', stop],
  ['reset', reset],
] as const) {
  app.post(`/api/workout/${path}`, async () => {
    fn();
    broadcastSnapshot('state');
    return snapshot();
  });
}

// ---- esecuzione ----
app.post<{ Params: { id: string } }>('/api/teams/:id/close', async (req) => {
  closeExercise(Number(req.params.id));
  broadcastSnapshot('team');
  return snapshot();
});

app.post<{ Params: { id: string } }>('/api/teams/:id/undo', async (req) => {
  undoExercise(Number(req.params.id));
  broadcastSnapshot('team');
  return snapshot();
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
