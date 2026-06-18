import type {
  AuthResponse,
  CreateExerciseBody,
  CreateTeamBody,
  LoginBody,
  SetExercisesBody,
  StartBody,
  UpdateExerciseBody,
  UpdateTeamBody,
  User,
  WorkoutSnapshot,
} from '@shared/index';

// Sessione scaduta / assente: le chiamate protette ricevono 401. Lo segnaliamo
// globalmente così App può tornare alla pagina di Login (anche su scadenza a metà sessione).
export class UnauthorizedError extends Error {
  constructor() {
    super('non autenticato');
  }
}

const unauthListeners = new Set<() => void>();

/** App si registra qui per tornare al Login quando una chiamata/SSE riceve 401. */
export function onUnauthorized(fn: () => void): () => void {
  unauthListeners.add(fn);
  return () => unauthListeners.delete(fn);
}

export function notifyUnauthorized(): void {
  for (const fn of unauthListeners) fn();
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  // login gestisce il proprio 401 (credenziali errate) senza trattarlo come "sessione persa"
  { handle401 = true }: { handle401?: boolean } = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include', // invia il cookie di sessione
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && handle401) {
    notifyUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(msg.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // ---- autenticazione ----
  // me(): null se non autenticato (401), così App mostra il Login senza errori.
  me: async (): Promise<User | null> => {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as AuthResponse).user;
  },
  login: (b: LoginBody) =>
    req<AuthResponse>('POST', '/api/auth/login', b, { handle401: false }).then((r) => r.user),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),

  // ---- allenamento ----
  getWorkout: () => req<WorkoutSnapshot>('GET', '/api/workout'),

  createTeam: (b: CreateTeamBody) => req<WorkoutSnapshot>('POST', '/api/teams', b),
  updateTeam: (id: number, b: UpdateTeamBody) => req<WorkoutSnapshot>('PATCH', `/api/teams/${id}`, b),
  deleteTeam: (id: number) => req<WorkoutSnapshot>('DELETE', `/api/teams/${id}`),
  setExercises: (id: number, b: SetExercisesBody) =>
    req<WorkoutSnapshot>('PUT', `/api/teams/${id}/exercises`, b),

  // ---- censimento esercizi ----
  createExercise: (b: CreateExerciseBody) => req<WorkoutSnapshot>('POST', '/api/exercises', b),
  updateExercise: (id: number, b: UpdateExerciseBody) =>
    req<WorkoutSnapshot>('PATCH', `/api/exercises/${id}`, b),
  deleteExercise: (id: number) => req<WorkoutSnapshot>('DELETE', `/api/exercises/${id}`),

  start: (b?: StartBody) => req<WorkoutSnapshot>('POST', '/api/workout/start', b ?? {}),
  pause: () => req<WorkoutSnapshot>('POST', '/api/workout/pause'),
  resume: () => req<WorkoutSnapshot>('POST', '/api/workout/resume'),
  stop: () => req<WorkoutSnapshot>('POST', '/api/workout/stop'),
  reset: () => req<WorkoutSnapshot>('POST', '/api/workout/reset'),

  close: (id: number) => req<WorkoutSnapshot>('POST', `/api/teams/${id}/close`),
  undo: (id: number) => req<WorkoutSnapshot>('POST', `/api/teams/${id}/undo`),
};
