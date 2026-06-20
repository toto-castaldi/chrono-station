import type { WorkoutSnapshot } from '@shared/index';
import { api } from '../lib/api.js';
import { formatTime } from '../lib/format.js';

export function Results({ snap }: { snap: WorkoutSnapshot }) {
  const teamById = (id: number) => snap.teams.find((t) => t.id === id);
  const exById = (id: number) => snap.exercises.find((e) => e.id === id);

  // classifica: finite per tempo totale crescente, poi le non finite (doc/00 014)
  const ranking = [...snap.progress].sort((a, b) => {
    if (a.finished && b.finished) return (a.totalMs ?? 0) - (b.totalMs ?? 0);
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.currentPosition - a.currentPosition;
  });

  return (
    <div className="page results">
      <header>
        <h1>Risultati</h1>
        <button onClick={() => api.reset()}>Nuovo allenamento</button>
      </header>

      <ol className="ranking">
        {ranking.map((p, i) => {
          const team = teamById(p.teamId);
          const order = team
            ? [...team.exercises].sort((a, b) => a.position - b.position)
            : [];
          const splits = [...p.splits].sort((a, b) => a.position - b.position);
          return (
            <li key={p.teamId} className="rank-row">
              <div className="rank-head" style={{ borderColor: team?.color }}>
                <span className="pos">{i + 1}</span>
                <span className="swatch" style={{ background: team?.color }} />
                <strong>{team?.name}</strong>
                <span className="total">
                  {p.finished ? formatTime(p.totalMs ?? 0) : `${p.currentPosition}/${p.total} (DNF)`}
                </span>
              </div>
              <table className="splits">
                <thead>
                  <tr>
                    <th>Esercizio</th>
                    <th>Parziale</th>
                    <th>Cumulativo</th>
                  </tr>
                </thead>
                <tbody>
                  {splits.map((s, idx) => {
                    // tempo per-esercizio = differenza tra split cumulativi consecutivi
                    // (il primo parte da 0); il cumulativo è il tempo dallo Start.
                    const prev = idx > 0 ? splits[idx - 1].cumulativeMs : 0;
                    const lap = s.cumulativeMs - prev;
                    return (
                      <tr key={s.position}>
                        <td>{exById(order[s.position]?.exerciseId ?? -1)?.name ?? s.position}</td>
                        <td>{formatTime(lap)}</td>
                        <td>{formatTime(s.cumulativeMs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
