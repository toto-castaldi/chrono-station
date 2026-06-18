import { useEffect, useState } from 'react';
import type { WorkoutSnapshot } from '@shared/index';

/**
 * Sottoscrive lo stream SSE del server e mantiene lo snapshot autoritativo.
 * - snapshot/state/team -> rimpiazza tutto lo stato
 * - tick -> aggiorna solo tempo e stato (il server resta l'autorità, doc/01 009)
 */
export function useWorkout(): WorkoutSnapshot | null {
  const [snap, setSnap] = useState<WorkoutSnapshot | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream');

    const onFull = (e: MessageEvent) => setSnap(JSON.parse(e.data) as WorkoutSnapshot);
    const onTick = (e: MessageEvent) => {
      const t = JSON.parse(e.data) as { elapsedMs: number; state: WorkoutSnapshot['state'] };
      setSnap((prev) => (prev ? { ...prev, elapsedMs: t.elapsedMs, state: t.state } : prev));
    };

    es.addEventListener('snapshot', onFull);
    es.addEventListener('state', onFull);
    es.addEventListener('team', onFull);
    es.addEventListener('tick', onTick);

    return () => es.close();
  }, []);

  return snap;
}
