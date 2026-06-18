import { useState } from 'react';
import type { Exercise, WorkoutSnapshot } from '@shared/index';
import { api } from '../lib/api.js';

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45'];

export function Onboarding({ snap }: { snap: WorkoutSnapshot }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [members, setMembers] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const run = (p: Promise<unknown>) => p.catch((e: Error) => setErr(e.message));

  const addTeam = () => {
    if (!name.trim()) return;
    run(
      api
        .createTeam({
          name: name.trim(),
          color,
          members: members.split(',').map((m) => m.trim()).filter(Boolean),
        })
        .then(() => {
          setName('');
          setMembers('');
        }),
    );
  };

  const exName = (id: number) => snap.exercises.find((e) => e.id === id)?.name ?? `#${id}`;

  const toggleExercise = (teamId: number, current: number[], ex: Exercise) => {
    const next = current.includes(ex.id)
      ? current.filter((id) => id !== ex.id)
      : [...current, ex.id];
    run(api.setExercises(teamId, { exerciseIds: next }));
  };

  const canStart =
    snap.teams.length > 0 && snap.teams.every((t) => t.exercises.length > 0);

  return (
    <div className="page onboarding">
      <header>
        <h1>Onboarding circuito</h1>
        <button className="primary" disabled={!canStart} onClick={() => run(api.start())}>
          Avvia ▶
        </button>
      </header>

      {err && <div className="error" onClick={() => setErr(null)}>{err} ✕</div>}

      <section className="new-team">
        <input placeholder="Nome squadra" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          placeholder="Membri (separati da virgola)"
          value={members}
          onChange={(e) => setMembers(e.target.value)}
        />
        <div className="colors">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color ? 'sel' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button onClick={addTeam}>+ Aggiungi squadra</button>
      </section>

      <section className="teams">
        {snap.teams.map((t) => {
          const chosen = [...t.exercises]
            .sort((a, b) => a.position - b.position)
            .map((e) => e.exerciseId);
          return (
            <div className="team-card" key={t.id} style={{ borderColor: t.color }}>
              <div className="team-head" style={{ background: t.color }}>
                <strong>{t.name}</strong>
                <span>{t.members.join(', ')}</span>
                <button onClick={() => run(api.deleteTeam(t.id))}>🗑</button>
              </div>
              <div className="exercise-order">
                {chosen.length === 0 ? (
                  <em>nessun esercizio selezionato</em>
                ) : (
                  <ol>
                    {chosen.map((id) => (
                      <li key={id}>{exName(id)}</li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="exercise-pick">
                {snap.exercises.map((ex) => (
                  <button
                    key={ex.id}
                    className={chosen.includes(ex.id) ? 'on' : ''}
                    onClick={() => toggleExercise(t.id, chosen, ex)}
                  >
                    {ex.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
