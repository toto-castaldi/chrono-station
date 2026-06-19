001. Due canali: REST per le azioni dell'operatore (ogni azione è una transazione persistita su PostgreSQL prima di riflettersi nello stream, doc/01 010), e SSE per ricevere tempo e stato dal server

001b. Autenticazione (doc/01 014): tutti gli endpoint richiedono una sessione valida (cookie httpOnly firmato) ad eccezione di `GET /api/health` e `POST /api/auth/login`. Senza sessione valida la risposta è `401 { error: 'non autenticato' }` e il client torna al login. Le richieste portano il cookie automaticamente (browser: `credentials: 'include'` / `EventSource` con `withCredentials`). Ogni risposta è limitata ai dati dell'utente autenticato.
- `POST /api/auth/login` ← `{ username, password }` → `{ user: { id, username } }` e imposta il cookie di sessione; credenziali errate → `401 { error: 'credenziali non valide' }`
- `POST /api/auth/logout` → `{ ok: true }` e azzera il cookie di sessione
- `GET /api/auth/me` → `{ user: { id, username } }` se autenticati, altrimenti `401` (il client lo usa al caricamento per decidere se mostrare il login)

002. Endpoint REST — lettura:
- `GET /api/exercises` → catalogo esercizi dell'utente autenticato
- `GET /api/workout` → `WorkoutSnapshot` corrente (qualunque pagina lo usa per ripartire dopo un reload)
- `GET /api/exercises/:id/image` → i byte dell'immagine dell'esercizio col rispettivo `Content-Type`; `404` se assente o non dell'utente. Disponibile **in tutti gli stati** (serve in esecuzione, non solo in onboarding). `Cache-Control` lungo: il contenuto a una data versione è immutabile, l'invalidazione avviene col query param `?v=imageVersion`

003. Endpoint REST — onboarding (consentiti solo con `state = 'onboarding'`):
- `POST /api/teams` → crea squadra `{ name, color, members[] }`
- `PATCH /api/teams/:id` → aggiorna nome/colore/membri/posizione
- `DELETE /api/teams/:id` → rimuove squadra
- `PUT /api/teams/:id/exercises` → imposta l'ordine esercizi `{ exerciseIds: number[] }` (ordine = indice nell'array); l'array può contenere **ripetizioni** dello stesso esercizio (più occorrenze a posizioni diverse, doc/00 003)
- `POST /api/exercises` → censisce un esercizio nel catalogo dell'utente `{ name, targetType, targetValue?, unit? }`; nome univoco per utente (case-insensitive)
- `PATCH /api/exercises/:id` → aggiorna nome/obiettivo di un esercizio
- `DELETE /api/exercises/:id` → elimina un esercizio; `409` se è ancora nell'ordine di una squadra (va prima rimosso da quelle squadre)
- `PUT /api/exercises/:id/image` ← `{ dataBase64, mime }` → associa/sostituisce l'immagine dell'esercizio; valida mime (`image/jpeg|png|webp`) e dimensione (max 2 MB decodificati), incrementa `imageVersion`. Il `bodyLimit` del server è alzato a 5 MB per accogliere il base64
- `DELETE /api/exercises/:id/image` → rimuove l'immagine dell'esercizio (incrementa comunque `imageVersion` per invalidare la cache)

004. Endpoint REST — controllo esecuzione:
- `POST /api/workout/start` → da `onboarding`: congela le squadre (doc/00 016), passa a `countdown`; al termine del countdown lo stato diventa `running` con `elapsed=0` (doc/00 015)
- `POST /api/workout/pause` → da `running` a `paused`
- `POST /api/workout/resume` → da `paused` a `running`
- `POST /api/workout/stop` → a `finished` (la conferma è l'alert lato client, doc/00 006/013); consentito (da `running` o `paused`) **solo se tutte le squadre hanno finito il circuito** (ogni `TeamProgress.finished`, con almeno una squadra): altrimenti `409` con messaggio «stop consentito solo quando tutte le squadre hanno finito il circuito»
- `POST /api/workout/reset` → riporta a `onboarding` per un nuovo allenamento (svuota squadre e split)
- `POST /api/workout/cancel` → falsa partenza (doc/00 022): da `countdown`/`running`/`paused` riporta a `onboarding` **mantenendo** squadre ed esercizi, azzerando solo il progresso (cancella gli split e resetta la pausa per-squadra). `409` se invocato da `onboarding` o `finished`. A differenza di `reset` non svuota le squadre

005. Endpoint REST — durante l'esecuzione:
- `POST /api/teams/:id/close` → chiude l'esercizio corrente della squadra: registra lo split col tempo attivo della squadra al netto delle pause individuali (doc/00 009, doc/05). Per evitare doppie chiusure, il server registra sempre e solo la `position` successiva attesa. `409` se la squadra è in pausa individuale (va prima ripresa)
- `POST /api/teams/:id/undo` → annulla l'ultima chiusura della squadra (doc/00 017)

005b. Endpoint REST — postazione occupata (doc/00 021), consentiti solo con `state = 'running'`:
- `POST /api/teams/:id/pause` → mette in pausa il solo contatore della squadra; `409` se già in pausa o se la squadra ha già finito. Non tocca l'orologio globale
- `POST /api/teams/:id/resume` → riprende il contatore della squadra scontando l'intervallo di pausa; `409` se la squadra non è in pausa
- `POST /api/teams/:id/switch` ← `{ exerciseId }` → scambia l'esercizio corrente con quello scelto (deve essere uno degli esercizi ancora da svolgere, posizione > corrente); `400` se non disponibile. La `currentPosition` non cambia (non consuma uno split)

006. Le mutazioni di stato/squadre sono rifiutate (409) se incompatibili con lo stato corrente (es. `close` fuori da `running`, `POST /api/teams` fuori da `onboarding`)

007. Stream SSE — `GET /api/stream` (autenticato via cookie; ogni utente riceve solo gli eventi del proprio allenamento, tick inclusi):
- alla connessione: evento `snapshot` con il `WorkoutSnapshot` completo (reload-safe)
- `tick`: `{ elapsedMs, state }` ogni ~1s mentre `running` (il client può interpolare tra i tick, ma l'autorità è il server, doc/01 009)
- `state`: ad ogni cambio di stato (start/countdown/pausa/ripresa/stop/cancel)
- `team`: ad ogni `close`/`undo`/`pause`/`resume`/`switch` di squadra, con il `TeamProgress` aggiornato (incluso il flag `paused`)

008. Risultati: la pagina usa il `WorkoutSnapshot` in stato `finished`; la classifica si ottiene ordinando le squadre `finished` per `totalMs` crescente, con i `splits` come dettaglio parziali (doc/00 014)
