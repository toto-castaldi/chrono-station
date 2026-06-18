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

  // doc/00 018: nome + almeno un membro obbligatori; nome (case-insensitive) e colore univoci.
  const usedColors = new Set(snap.teams.map((t) => t.color));
  const usedNames = new Set(snap.teams.map((t) => t.name.trim().toLowerCase()));
  const firstFreeColor = (used: Set<string>) => COLORS.find((c) => !used.has(c)) ?? COLORS[0];

  const trimmedName = name.trim();
  const memberList = members.split(',').map((m) => m.trim()).filter(Boolean);
  const nameDuplicate = trimmedName !== '' && usedNames.has(trimmedName.toLowerCase());
  const colorTaken = usedColors.has(color);
  const canAddTeam =
    trimmedName !== '' && memberList.length > 0 && !nameDuplicate && !colorTaken;

  const addTeam = () => {
    if (!canAddTeam) return;
    run(
      api
        .createTeam({ name: trimmedName, color, members: memberList })
        .then(() => {
          setName('');
          setMembers('');
          setColor(firstFreeColor(new Set([...usedColors, color])));
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
          {COLORS.map((c) => {
            const taken = usedColors.has(c);
            return (
              <button
                key={c}
                className={`swatch ${c === color ? 'sel' : ''} ${taken ? 'taken' : ''}`}
                style={{ background: c }}
                disabled={taken}
                title={taken ? 'colore già usato' : undefined}
                onClick={() => setColor(c)}
              />
            );
          })}
        </div>
        <button disabled={!canAddTeam} onClick={addTeam}>
          + Aggiungi squadra
        </button>
        {nameDuplicate && <span className="hint">nome squadra già usato</span>}
        {colorTaken && <span className="hint">colore già usato, scegline un altro</span>}
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
