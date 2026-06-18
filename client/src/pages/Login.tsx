import { useState } from 'react';
import type { User } from '@shared/index';
import { api } from '../lib/api.js';

// Pagina di accesso: unica via d'ingresso. Nessuna registrazione pubblica
// (utenti creati via seed/admin). Mostrata finché non si è autenticati.
export function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    api
      .login({ username: username.trim(), password })
      .then(onSuccess)
      .catch((ex: Error) => {
        setErr(ex.message);
        setBusy(false);
      });
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>Chrono Station</h1>
        {err && <div className="error">{err}</div>}
        <label>
          Utente
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className="primary" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? 'Accesso…' : 'Accedi'}
        </button>
      </form>
    </div>
  );
}
