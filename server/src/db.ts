import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

// Lo schema NON è più creato qui: è definito by code con Liquibase
// (server/db/changelog, vedi doc/05-data-model.md). In dev si applica con
// `npm run db:migrate`, in prod col servizio `migrate` all'avvio (doc/04-devops.md).
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://chrono:chrono@localhost:5432/chrono';

// I tempi (epoch ms) sono BIGINT: pg li restituirebbe come stringa. Li riportiamo
// a number — i valori in gioco (ms epoch, durate) stanno ben dentro Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

/** Esegue una query e ritorna le righe tipizzate. */
export async function all<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(sql, params);
  return res.rows;
}

/** Prima riga del result set, o undefined. */
export async function get<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const res = await pool.query<T>(sql, params);
  return res.rows[0];
}

/** Esegue `fn` dentro una transazione su un client dedicato (BEGIN/COMMIT/ROLLBACK). */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
