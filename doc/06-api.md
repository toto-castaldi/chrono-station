001. Due canali: REST per le azioni dell'operatore (ogni azione è una transazione persistita su SQLite prima di riflettersi nello stream, doc/01 010), e SSE per ricevere tempo e stato dal server

002. Endpoint REST — lettura:
- `GET /api/exercises` → catalogo esercizi
- `GET /api/workout` → `WorkoutSnapshot` corrente (qualunque pagina lo usa per ripartire dopo un reload)

003. Endpoint REST — onboarding (consentiti solo con `state = 'onboarding'`):
- `POST /api/teams` → crea squadra `{ name, color, members[] }`
- `PATCH /api/teams/:id` → aggiorna nome/colore/membri/posizione
- `DELETE /api/teams/:id` → rimuove squadra
- `PUT /api/teams/:id/exercises` → imposta l'ordine esercizi `{ exerciseIds: number[] }` (ordine = indice nell'array)

004. Endpoint REST — controllo esecuzione:
- `POST /api/workout/start` → da `onboarding`: congela le squadre (doc/00 016), passa a `countdown`; al termine del countdown lo stato diventa `running` con `elapsed=0` (doc/00 015)
- `POST /api/workout/pause` → da `running` a `paused`
- `POST /api/workout/resume` → da `paused` a `running`
- `POST /api/workout/stop` → a `finished` (la conferma è l'alert lato client, doc/00 006/013)
- `POST /api/workout/reset` → riporta a `onboarding` per un nuovo allenamento (svuota squadre e split)

005. Endpoint REST — durante l'esecuzione:
- `POST /api/teams/:id/close` → chiude l'esercizio corrente della squadra: registra lo split col tempo cumulativo (doc/00 009). Per evitare doppie chiusure, il server registra sempre e solo la `position` successiva attesa
- `POST /api/teams/:id/undo` → annulla l'ultima chiusura della squadra (doc/00 017)

006. Le mutazioni di stato/squadre sono rifiutate (409) se incompatibili con lo stato corrente (es. `close` fuori da `running`, `POST /api/teams` fuori da `onboarding`)

007. Stream SSE — `GET /api/stream`:
- alla connessione: evento `snapshot` con il `WorkoutSnapshot` completo (reload-safe)
- `tick`: `{ elapsedMs, state }` ogni ~1s mentre `running` (il client può interpolare tra i tick, ma l'autorità è il server, doc/01 009)
- `state`: ad ogni cambio di stato (start/countdown/pausa/ripresa/stop)
- `team`: ad ogni `close`/`undo`, con il `TeamProgress` aggiornato della squadra

008. Risultati: la pagina usa il `WorkoutSnapshot` in stato `finished`; la classifica si ottiene ordinando le squadre `finished` per `totalMs` crescente, con i `splits` come dettaglio parziali (doc/00 014)
