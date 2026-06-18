import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LoginBody, User } from '@shared/index';
import { get } from './db.js';
import { HttpError } from './store.js';

// Sessione via cookie firmato (HMAC) che trasporta solo lo userId.
// Scelta perché EventSource (SSE) invia i cookie automaticamente e non
// supporta header custom (doc/01, doc/06). Lo userId non è sensibile; la
// firma ne impedisce la manomissione. Nessuna tabella di sessione: il cookie
// è stateless e sopravvive a restart/deploy (il segreto è in env).
const COOKIE = 'cs_session';
const isProd = process.env.NODE_ENV === 'production';

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: isProd, // in dev (http) un cookie secure verrebbe scartato dal browser
  signed: true,
  maxAge: 60 * 60 * 24 * 30, // 30 giorni (secondi)
};

// Estende FastifyRequest con lo userId risolto dall'hook di autenticazione.
declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

export function setSession(reply: FastifyReply, userId: number): void {
  reply.setCookie(COOKIE, String(userId), cookieOpts);
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: '/' });
}

/** Legge e verifica lo userId dal cookie firmato; null se assente/non valido. */
export function readUserId(req: FastifyRequest): number | null {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const r = req.unsignCookie(raw);
  if (!r.valid || r.value === null) return null;
  const id = Number(r.value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

/** Verifica le credenziali; 401 con messaggio generico se non valide. */
export async function login(body: LoginBody): Promise<User> {
  const username = (body?.username ?? '').trim();
  const password = body?.password ?? '';
  const row = await get<UserRow>(
    'SELECT id, username, password_hash FROM app_user WHERE username = $1',
    [username],
  );
  if (!row || !(await bcrypt.compare(password, row.password_hash)))
    throw new HttpError(401, 'credenziali non valide');
  return { id: row.id, username: row.username };
}

/** Ricarica l'utente dal DB (per GET /api/auth/me); null se non esiste più. */
export async function getUser(userId: number): Promise<User | null> {
  const row = await get<{ id: number; username: string }>(
    'SELECT id, username FROM app_user WHERE id = $1',
    [userId],
  );
  return row ? { id: row.id, username: row.username } : null;
}
