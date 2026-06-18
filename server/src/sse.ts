import type { ServerResponse } from 'node:http';
import type { SseEvent } from '@shared/index';
import { snapshot, tickState } from './store.js';

// Client SSE partizionati per utente: ogni utente riceve solo gli eventi del
// proprio allenamento (multitenancy, doc/06). La connessione è già autenticata
// dall'hook in index.ts (il cookie viaggia con EventSource).
const clients = new Map<number, Set<ServerResponse>>();

function write(res: ServerResponse, event: SseEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

export async function addClient(userId: number, res: ServerResponse): Promise<void> {
  let set = clients.get(userId);
  if (!set) {
    set = new Set<ServerResponse>();
    clients.set(userId, set);
  }
  set.add(res);
  // snapshot iniziale: rende qualunque pagina reload-safe (doc/01 001)
  write(res, { type: 'snapshot', data: await snapshot(userId) });
  res.on('close', () => {
    const s = clients.get(userId);
    if (!s) return;
    s.delete(res);
    if (s.size === 0) clients.delete(userId);
  });
}

function broadcast(userId: number, event: SseEvent): void {
  const set = clients.get(userId);
  if (!set) return;
  for (const res of set) write(res, event);
}

/** Da chiamare dopo ogni mutazione REST per propagare lo stato aggiornato all'utente. */
export async function broadcastSnapshot(userId: number, kind: 'state' | 'team'): Promise<void> {
  broadcast(userId, { type: kind, data: await snapshot(userId) });
}

/** Tick periodico del tempo globale, per utente (doc/06-api.md 007). */
export function startTicker(): NodeJS.Timeout {
  return setInterval(() => {
    if (clients.size === 0) return;
    // solo gli utenti con almeno un client connesso vengono "tickati"
    for (const userId of clients.keys()) {
      void (async () => {
        const { elapsedMs, state, changed } = await tickState(userId);
        if (changed) {
          // countdown -> running: manda lo snapshot completo
          broadcast(userId, { type: 'state', data: await snapshot(userId) });
        }
        if (state === 'running' || state === 'countdown') {
          broadcast(userId, { type: 'tick', data: { elapsedMs, state } });
        }
      })();
    }
  }, 1000);
}
