import { useState } from 'react';
import type { Exercise, TargetType, WorkoutSnapshot } from '@shared/index';
import { api, exerciseImageUrl } from '../lib/api.js';

const TARGET_LABELS: Record<TargetType, string> = {
  none: 'Nessuno',
  reps: 'Ripetizioni',
  distance: 'Distanza',
};
const DEFAULT_UNIT: Record<TargetType, string> = { none: '', reps: 'reps', distance: 'm' };

const targetText = (ex: Exercise) =>
  ex.targetType === 'none' ? '—' : `${ex.targetValue} ${ex.unit ?? ''}`.trim();

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

      <ExerciseCatalog exercises={snap.exercises} run={run} />

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
                {snap.exercises.length === 0 ? (
                  <em>censisci prima gli esercizi</em>
                ) : (
                  snap.exercises.map((ex) => (
                    <button
                      key={ex.id}
                      className={chosen.includes(ex.id) ? 'on' : ''}
                      onClick={() => toggleExercise(t.id, chosen, ex)}
                    >
                      {ex.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

// Censimento esercizi: catalogo per-utente (CRUD), definito in onboarding.
function ExerciseCatalog({
  exercises,
  run,
}: {
  exercises: Exercise[];
  run: (p: Promise<unknown>) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<TargetType>('none');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  // immagine in attesa di upload (nuovo esercizio o sostituzione); fileKey resetta l'<input file>
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const reset = () => {
    setEditId(null);
    setName('');
    setType('none');
    setValue('');
    setUnit('');
    setFile(null);
    setFileKey((k) => k + 1);
  };

  const editing = editId !== null ? exercises.find((e) => e.id === editId) : undefined;

  const pickType = (t: TargetType) => {
    setType(t);
    if (t !== 'none' && !unit) setUnit(DEFAULT_UNIT[t]);
  };

  const trimmed = name.trim();
  const numValue = Number(value);
  const targetOk = type === 'none' || (Number.isInteger(numValue) && numValue > 0 && unit.trim() !== '');
  const canSave = trimmed !== '' && targetOk;

  const body = () => ({
    name: trimmed,
    targetType: type,
    targetValue: type === 'none' ? undefined : numValue,
    unit: type === 'none' ? undefined : unit.trim(),
  });

  const save = () => {
    if (!canSave) return;
    // dopo create/update, se c'è un file in attesa lo si carica sull'esercizio (che è unico per nome)
    const saved =
      editId === null
        ? api.createExercise(body()).then((snap) =>
            file
              ? snap.exercises.find((e) => e.name.toLowerCase() === trimmed.toLowerCase())?.id
              : undefined,
          )
        : api.updateExercise(editId, body()).then(() => (file ? editId : undefined));
    run(
      saved
        .then((id) => (id != null && file ? api.setExerciseImage(id, file) : undefined))
        .then(reset),
    );
  };

  const startEdit = (ex: Exercise) => {
    setEditId(ex.id);
    setName(ex.name);
    setType(ex.targetType);
    setValue(ex.targetValue !== undefined ? String(ex.targetValue) : '');
    setUnit(ex.unit ?? '');
  };

  return (
    <section className="exercise-catalog">
      <h2>Esercizi</h2>
      <div className="exercise-form">
        <input
          placeholder="Nome esercizio"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select value={type} onChange={(e) => pickType(e.target.value as TargetType)}>
          {(['none', 'reps', 'distance'] as TargetType[]).map((t) => (
            <option key={t} value={t}>
              {TARGET_LABELS[t]}
            </option>
          ))}
        </select>
        {type !== 'none' && (
          <>
            <input
              className="target-value"
              type="number"
              min="1"
              placeholder="Valore"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <input
              className="target-unit"
              placeholder="Unità"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </>
        )}
        <label className="image-pick">
          🖼
          <input
            key={fileKey}
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? file.name : editing?.hasImage ? 'sostituisci immagine' : 'immagine (opzionale)'}
        </label>
        {/* immagine già presente (in modifica): anteprima + rimozione */}
        {editing && exerciseImageUrl(editing) && !file && (
          <span className="image-current">
            <img src={exerciseImageUrl(editing)!} alt="" />
            <button onClick={() => run(api.deleteExerciseImage(editing.id))} title="rimuovi immagine">
              ✕
            </button>
          </span>
        )}
        <button disabled={!canSave} onClick={save}>
          {editId === null ? '+ Aggiungi esercizio' : 'Salva'}
        </button>
        {editId !== null && <button onClick={reset}>Annulla</button>}
      </div>

      {exercises.length === 0 ? (
        <p className="hint">nessun esercizio censito</p>
      ) : (
        <ul className="exercise-list">
          {exercises.map((ex) => (
            <li key={ex.id}>
              {exerciseImageUrl(ex) && (
                <img className="ex-thumb" src={exerciseImageUrl(ex)!} alt="" />
              )}
              <span className="ex-name">{ex.name}</span>
              <span className="ex-target">{targetText(ex)}</span>
              <button onClick={() => startEdit(ex)} title="modifica">
                ✎
              </button>
              <button onClick={() => run(api.deleteExercise(ex.id))} title="elimina">
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
