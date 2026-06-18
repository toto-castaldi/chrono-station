import type { ServerResponse } from 'node:http';
import type { SseEvent } from '@shared/index';
import { snapshot, tickState } from './store.js';

const clients = new Set<ServerResponse>();

function write(res: ServerResponse, event: SseEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

export async function addClient(res: ServerResponse): Promise<void> {
  clients.add(res);
  // snapshot iniziale: rende qualunque pagina reload-safe (doc/01 001)
  write(res, { type: 'snapshot', data: await snapshot() });
  res.on('close', () => clients.delete(res));
}

function broadcast(event: SseEvent): void {
  for (const res of clients) write(res, event);
}

/** Da chiamare dopo ogni mutazione REST per propagare lo stato aggiornato. */
export async function broadcastSnapshot(kind: 'state' | 'team'): Promise<void> {
  broadcast({ type: kind, data: await snapshot() });
}

/** Tick periodico del tempo globale (doc/06-api.md 007). */
export function startTicker(): NodeJS.Timeout {
  return setInterval(() => {
    if (clients.size === 0) return;
    void (async () => {
      const { elapsedMs, state, changed } = await tickState();
      if (changed) {
        // countdown -> running: manda lo snapshot completo
        broadcast({ type: 'state', data: await snapshot() });
      }
      if (state === 'running' || state === 'countdown') {
        broadcast({ type: 'tick', data: { elapsedMs, state } });
      }
    })();
  }, 1000);
}
