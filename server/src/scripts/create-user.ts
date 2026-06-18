// Crea (o aggiorna la password di) un utente dell'app.
// Gli utenti si creano solo qui (seed/admin): non esiste registrazione pubblica (doc/00 019).
//
//   npm run user:create -- <username> <password>
//
// Usa DATABASE_URL (default dev: postgres://chrono:chrono@localhost:5432/chrono).
import bcrypt from 'bcryptjs';
import { get, pool } from '../db.js';

async function main(): Promise<void> {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Uso: npm run user:create -- <username> <password>');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const row = await get<{ id: number; username: string }>(
    `INSERT INTO app_user (username, password_hash, created_at)
       VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, username`,
    [username, hash, Date.now()],
  );

  console.log(`utente pronto: id=${row?.id} username=${row?.username}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
