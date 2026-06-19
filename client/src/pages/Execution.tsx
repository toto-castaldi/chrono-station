import { useState } from 'react';
import type { TeamProgress, WorkoutSnapshot } from '@shared/index';
import { api, exerciseImageUrl } from '../lib/api.js';
import { formatTime } from '../lib/format.js';

export function Execution({ snap }: { snap: WorkoutSnapshot }) {
  const [err, setErr] = useState<string | null>(null);
  // id della squadra il cui selettore "cambia esercizio" è aperto (uno alla volta)
  const [chooser, setChooser] = useState<number | null>(null);
  const run = (p: Promise<unknown>) => p.catch((e: Error) => setErr(e.message));

  const progressOf = (teamId: number): TeamProgress | undefined =>
    snap.progress.find((p) => p.teamId === teamId);

  const allFinished = snap.progress.length > 0 && snap.progress.every((p) => p.finished);

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
            disabled={!allFinished}
            title={allFinished ? undefined : 'Tutte le squadre devono finire il circuito'}
            onClick={() => {
              if (confirm('Terminare l\'allenamento?')) run(api.stop());
            }}
          >
            ⏹ Stop
          </button>
          <button
            className="cancel-start"
            title="Torna alla preparazione mantenendo squadre ed esercizi"
            onClick={() => {
              if (
                confirm(
                  'Annullare la partenza e tornare alla preparazione? ' +
                    'Squadre ed esercizi restano salvati; i parziali registrati saranno cancellati.',
                )
              )
                run(api.cancel());
            }}
          >
            ✕ Annulla
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
          const paused = p?.paused ?? false;
          const running = snap.state === 'running';
          const currentRef = [...t.exercises]
            .sort((a, b) => a.position - b.position)
            .find((e) => e.position === pos);
          const ex = currentRef && snap.exercises.find((e) => e.id === currentRef.exerciseId);
          // esercizi ancora da svolgere oltre quello corrente (postazione occupata → cambio).
          // Dedup per id: lo stesso esercizio può ripetersi a più posizioni, ma nel selettore
          // va mostrato una volta sola (lo switch porta avanti la prima occorrenza futura).
          const remaining = Array.from(
            new Map(
              [...t.exercises]
                .filter((e) => e.position > pos)
                .sort((a, b) => a.position - b.position)
                .map((e) => snap.exercises.find((x) => x.id === e.exerciseId))
                .filter((x): x is NonNullable<typeof x> => Boolean(x))
                .map((x) => [x.id, x] as const),
            ).values(),
          );

          return (
            <div
              className={`lane${paused ? ' paused' : ''}`}
              key={t.id}
              style={{ borderColor: t.color }}
            >
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

                {paused && (
                  <div className="lane-pause-overlay">
                    <div className="pause-label">⏸ IN PAUSA</div>
                    <button className="resume-team" disabled={!running} onClick={() => run(api.resumeTeam(t.id))}>
                      ▶ Riprendi
                    </button>
                  </div>
                )}

                {chooser === t.id && !paused && (
                  <div className="ex-chooser">
                    <div className="ex-chooser-head">
                      <span>Cambia esercizio</span>
                      <button className="ex-chooser-close" onClick={() => setChooser(null)}>✕</button>
                    </div>
                    {remaining.length === 0 ? (
                      <em>nessun altro esercizio da svolgere</em>
                    ) : (
                      remaining.map((rx) => (
                        <button
                          key={rx.id}
                          className="ex-chooser-item"
                          onClick={() => {
                            setChooser(null);
                            run(api.switchExercise(t.id, rx.id));
                          }}
                        >
                          {rx.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {/* Chiudi esercizio è il tasto primario, grande e isolato: le azioni
                  secondarie stanno in una fascia staccata sotto per evitare tocchi
                  accidentali (doc/02 003) */}
              <div className="lane-actions primary">
                <button
                  className="close"
                  disabled={finished || paused || !running}
                  onClick={() => run(api.close(t.id))}
                >
                  Chiudi esercizio
                </button>
              </div>
              <div className="lane-actions secondary">
                <button
                  className="undo"
                  disabled={pos === 0}
                  onClick={() => run(api.undo(t.id))}
                >
                  ↶ Undo
                </button>
                {!finished &&
                  (paused ? (
                    <button className="resume-team" disabled={!running} onClick={() => run(api.resumeTeam(t.id))}>
                      ▶ Riprendi squadra
                    </button>
                  ) : (
                    <button className="pause-team" disabled={!running} onClick={() => run(api.pauseTeam(t.id))}>
                      ⏸ Pausa squadra
                    </button>
                  ))}
                {!finished && (
                  <button
                    className="switch"
                    disabled={paused || !running || remaining.length === 0}
                    onClick={() => setChooser((c) => (c === t.id ? null : t.id))}
                  >
                    ⇄ Cambia esercizio
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
