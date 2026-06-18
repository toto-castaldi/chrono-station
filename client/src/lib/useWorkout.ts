import { useEffect, useState } from 'react';
import type { WorkoutSnapshot } from '@shared/index';
import { api, notifyUnauthorized } from './api.js';

/**
 * Sottoscrive lo stream SSE del server e mantiene lo snapshot autoritativo.
 * - snapshot/state/team -> rimpiazza tutto lo stato
 * - tick -> aggiorna solo tempo e stato (il server resta l'autorità, doc/01 009)
 * Se la connessione cade e la sessione è scaduta (401) torna al Login.
 */
export function useWorkout(): WorkoutSnapshot | null {
  const [snap, setSnap] = useState<WorkoutSnapshot | null>(null);

  useEffect(() => {
    // withCredentials: invia il cookie di sessione anche sullo stream SSE
    const es = new EventSource('/api/stream', { withCredentials: true });

    const onFull = (e: MessageEvent) => setSnap(JSON.parse(e.data) as WorkoutSnapshot);
    const onTick = (e: MessageEvent) => {
      const t = JSON.parse(e.data) as { elapsedMs: number; state: WorkoutSnapshot['state'] };
      setSnap((prev) => (prev ? { ...prev, elapsedMs: t.elapsedMs, state: t.state } : prev));
    };

    es.addEventListener('snapshot', onFull);
    es.addEventListener('state', onFull);
    es.addEventListener('team', onFull);
    es.addEventListener('tick', onTick);

    // se lo stream si chiude in errore, verifica la sessione: se scaduta torna al Login
    // (altrimenti EventSource ritenterebbe all'infinito ricevendo sempre 401).
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        void api.me().then((u) => {
          if (!u) notifyUnauthorized();
        });
      }
    };

    return () => es.close();
  }, []);

  return snap;
}
