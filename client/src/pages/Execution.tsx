import { useState } from 'react';
import type { TeamProgress, WorkoutSnapshot } from '@shared/index';
import { api, exerciseImageUrl } from '../lib/api.js';
import { formatTime } from '../lib/format.js';

export function Execution({ snap }: { snap: WorkoutSnapshot }) {
  const [err, setErr] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => p.catch((e: Error) => setErr(e.message));

  const progressOf = (teamId: number): TeamProgress | undefined =>
    snap.progress.find((p) => p.teamId === teamId);

  const countdownLeft =
    snap.state === 'countdown' && snap.countdownEndsAt
      ? Math.max(0, Math.ceil((snap.countdownEndsAt - Date.now()) / 1000))
      : 0;

  return (
    <div className="page execution">
      {snap.state === 'countdown' && (
        <div className="countdown-overlay">
          <span>{countdownLeft || 'VIA!'}</span>
        </div>
      )}

      <header>
        <div className="global-timer">{formatTime(snap.elapsedMs)}</div>
        <div className="controls">
          {snap.state === 'running' ? (
            <button onClick={() => run(api.pause())}>⏸ Pausa</button>
          ) : (
            <button disabled={snap.state !== 'paused'} onClick={() => run(api.resume())}>
              ▶ Riprendi
            </button>
          )}
          <button
            className="danger"
            onClick={() => {
              if (confirm('Terminare l\'allenamento?')) run(api.stop());
            }}
          >
            ⏹ Stop
          </button>
        </div>
      </header>

      {err && <div className="error" onClick={() => setErr(null)}>{err} ✕</div>}

      <section className="lanes">
        {snap.teams.map((t) => {
          const p = progressOf(t.id);
          const total = p?.total ?? t.exercises.length;
          const pos = p?.currentPosition ?? 0;
          const finished = p?.finished ?? false;
          const currentRef = [...t.exercises]
            .sort((a, b) => a.position - b.position)
            .find((e) => e.position === pos);
          const ex = currentRef && snap.exercises.find((e) => e.id === currentRef.exerciseId);

          return (
            <div className="lane" key={t.id} style={{ borderColor: t.color }}>
              <div className="lane-head" style={{ background: t.color }}>
                <strong>{t.name}</strong>
                <span>{pos}/{total}</span>
              </div>
              <div className="lane-body">
                {finished ? (
                  <div className="done">✔ finito — {formatTime(p?.totalMs ?? 0)}</div>
                ) : ex ? (
                  <>
                    {exerciseImageUrl(ex) ? (
                      <img className="ex-image" src={exerciseImageUrl(ex)!} alt={ex.name} />
                    ) : (
                      <div className="ex-image placeholder" aria-hidden="true">🏋️</div>
                    )}
                    <div className="current-ex">{ex.name}</div>
                    {ex.targetType !== 'none' && (
                      <div className="target">
                        obiettivo: {ex.targetValue} {ex.unit}
                      </div>
                    )}
                  </>
                ) : (
                  <em>—</em>
                )}
              </div>
              <div className="lane-actions">
                <button
                  className="close"
                  disabled={finished || snap.state !== 'running'}
                  onClick={() => run(api.close(t.id))}
                >
                  Chiudi esercizio
                </button>
                <button
                  className="undo"
                  disabled={pos === 0}
                  onClick={() => run(api.undo(t.id))}
                >
                  ↶ Undo
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
