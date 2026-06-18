import { useEffect, useState } from 'react';
import type { User } from '@shared/index';
import { api, onUnauthorized } from './lib/api.js';
import { useWorkout } from './lib/useWorkout.js';
import { Execution } from './pages/Execution.js';
import { Login } from './pages/Login.js';
import { Onboarding } from './pages/Onboarding.js';
import { Results } from './pages/Results.js';

// Gate di autenticazione sopra lo snapshot: l'app mostra il Login finché non
// si è autenticati, e vi ritorna su logout o scadenza sessione (401). Solo da
// autenticati si apre lo stream del proprio allenamento.
export function App() {
  // undefined = verifica in corso; null = non autenticato; User = autenticato
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
    // qualunque chiamata/SSE con 401 fa tornare al Login
    return onUnauthorized(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="loading">connessione…</div>;
  if (!user) return <Login onSuccess={setUser} />;
  return <Workout username={user.username} onLoggedOut={() => setUser(null)} />;
}

// Sottoalbero autenticato: smontandolo (logout/401) si chiude l'EventSource e
// il server rimuove il client SSE.
function Workout({ username, onLoggedOut }: { username: string; onLoggedOut: () => void }) {
  const snap = useWorkout();

  const logout = () => {
    void api.logout().finally(onLoggedOut);
  };

  return (
    <>
      {!snap ? (
        <div className="loading">connessione…</div>
      ) : snap.state === 'onboarding' ? (
        <Onboarding snap={snap} />
      ) : snap.state === 'finished' ? (
        <Results snap={snap} />
      ) : (
        <Execution snap={snap} />
      )}
      <button className="logout" onClick={logout} title={`Esci (${username})`}>
        Esci
      </button>
    </>
  );
}
