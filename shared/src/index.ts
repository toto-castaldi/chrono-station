// Tipi condivisi tra client e server (vedi doc/05-data-model.md).
// Contiene SOLO tipi: viene cancellato a compile-time, quindi i consumer
// usano `import type` e non c'è alcuna dipendenza runtime.

export type WorkoutState =
  | 'onboarding'
  | 'countdown'
  | 'running'
  | 'paused'
  | 'finished';

export type TargetType = 'none' | 'reps' | 'distance';

export interface Exercise {
  id: number;
  name: string;
  targetType: TargetType;
  targetValue?: number;
  unit?: string;
  // Immagine opzionale (doc/03 005): i byte NON viaggiano nello snapshot — si scaricano
  // da GET /api/exercises/:id/image. imageVersion (0 = nessuna) serve al cache-busting (?v=).
  hasImage: boolean;
  imageVersion: number;
}

export interface TeamExerciseRef {
  exerciseId: number;
  position: number;
}

export interface Split {
  position: number;
  cumulativeMs: number;
}

export interface Team {
  id: number;
  name: string;
  color: string;
  position: number;
  members: string[];
  exercises: TeamExerciseRef[];
}

export interface TeamProgress {
  teamId: number;
  currentPosition: number;
  total: number;
  finished: boolean;
  totalMs?: number;
  splits: Split[];
  // Pausa per-squadra (doc/05): true mentre il contatore della sola squadra è fermo,
  // indipendentemente dall'orologio globale.
  paused: boolean;
}

export interface WorkoutSnapshot {
  state: WorkoutState;
  elapsedMs: number;
  countdownEndsAt?: number;
  teams: Team[];
  progress: TeamProgress[];
  exercises: Exercise[];
}

// ---- payload delle azioni REST ----

export interface CreateTeamBody {
  name: string;
  color: string;
  members: string[];
}

export interface UpdateTeamBody {
  name?: string;
  color?: string;
  members?: string[];
  position?: number;
}

export interface SetExercisesBody {
  exerciseIds: number[];
}

// Cambio esercizio in esecuzione: la squadra trova la postazione occupata e svolge
// un altro esercizio tra quelli ancora da fare (scambio di posizione).
export interface SwitchExerciseBody {
  exerciseId: number;
}

// Censimento esercizi (catalogo per-utente, definito in onboarding).
export interface CreateExerciseBody {
  name: string;
  targetType: TargetType; // 'none' | 'reps' | 'distance'
  targetValue?: number;
  unit?: string;
}

export interface UpdateExerciseBody {
  name?: string;
  targetType?: TargetType;
  targetValue?: number;
  unit?: string;
}

// Upload dell'immagine di un esercizio: il client ridimensiona/comprime e invia base64.
export interface SetExerciseImageBody {
  dataBase64: string; // payload base64 (senza prefisso data:)
  mime: string; // 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface StartBody {
  countdownSecs?: number;
}

// ---- autenticazione ----

// Utente esposto al client: mai il password_hash.
export interface User {
  id: number;
  username: string;
}

export interface LoginBody {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: User;
}

// ---- eventi SSE ----

export type SseEvent =
  | { type: 'snapshot'; data: WorkoutSnapshot }
  | { type: 'state'; data: WorkoutSnapshot }
  | { type: 'team'; data: WorkoutSnapshot }
  | { type: 'tick'; data: { elapsedMs: number; state: WorkoutState } };
