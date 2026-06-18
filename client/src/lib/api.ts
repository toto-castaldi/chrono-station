import type {
  CreateTeamBody,
  SetExercisesBody,
  StartBody,
  UpdateTeamBody,
  WorkoutSnapshot,
} from '@shared/index';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(msg.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getWorkout: () => req<WorkoutSnapshot>('GET', '/api/workout'),

  createTeam: (b: CreateTeamBody) => req<WorkoutSnapshot>('POST', '/api/teams', b),
  updateTeam: (id: number, b: UpdateTeamBody) => req<WorkoutSnapshot>('PATCH', `/api/teams/${id}`, b),
  deleteTeam: (id: number) => req<WorkoutSnapshot>('DELETE', `/api/teams/${id}`),
  setExercises: (id: number, b: SetExercisesBody) =>
    req<WorkoutSnapshot>('PUT', `/api/teams/${id}/exercises`, b),

  start: (b?: StartBody) => req<WorkoutSnapshot>('POST', '/api/workout/start', b ?? {}),
  pause: () => req<WorkoutSnapshot>('POST', '/api/workout/pause'),
  resume: () => req<WorkoutSnapshot>('POST', '/api/workout/resume'),
  stop: () => req<WorkoutSnapshot>('POST', '/api/workout/stop'),
  reset: () => req<WorkoutSnapshot>('POST', '/api/workout/reset'),

  close: (id: number) => req<WorkoutSnapshot>('POST', `/api/teams/${id}/close`),
  undo: (id: number) => req<WorkoutSnapshot>('POST', `/api/teams/${id}/undo`),
};
