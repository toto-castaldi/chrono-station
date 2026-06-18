import { useWorkout } from './lib/useWorkout.js';
import { Execution } from './pages/Execution.js';
import { Onboarding } from './pages/Onboarding.js';
import { Results } from './pages/Results.js';

// La pagina mostrata è dettata dallo stato del server (single-workout):
// così un reload riapre sempre la schermata giusta (doc/01 001).
export function App() {
  const snap = useWorkout();

  if (!snap) return <div className="loading">connessione…</div>;

  switch (snap.state) {
    case 'onboarding':
      return <Onboarding snap={snap} />;
    case 'countdown':
    case 'running':
    case 'paused':
      return <Execution snap={snap} />;
    case 'finished':
      return <Results snap={snap} />;
  }
}
