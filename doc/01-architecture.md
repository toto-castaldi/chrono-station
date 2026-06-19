001. L'applicazione ha una interfaccia web ma lo stato di un allenamento è tutto server side. Reload di pagina, crash del tablet, o altre interazioni non volute sul client non fanno perdere informazioni su un allenamento in corso

002. Il client fa stream del tempo che passa dal server

003. ad ogni chiusura esercizio viene segnato il tempo parziale memorizzato sul server

004. l'applicazione è multi-utente: ogni utente autenticato gestisce un proprio allenamento alla volta, isolato dagli altri. Lo stato e i dati sono partizionati per utente sia in lettura sia in scrittura

005. Stack: server Node.js + TypeScript (Fastify); client SPA React + Vite + TypeScript; persistenza PostgreSQL (driver `pg`); schema gestito by code con Liquibase; comunicazione realtime dal server via SSE

006. Repository monorepo: `client/` (React), `server/` (Node), `shared/` (tipi TypeScript condivisi: modelli squadra, esercizio, stato allenamento, eventi)

007. Il server è l'unico orologio autoritativo. Non incrementa un contatore in un loop: memorizza l'istante d'inizio e gli intervalli di pausa, e calcola il tempo trascorso in funzione del wall-clock. Così il tempo è sempre ricostruibile dopo un riavvio

008. Lo stato dell'allenamento è una macchina a stati GLOBALE: onboarding → countdown → running ⇄ paused → finished. Da countdown/running/paused è inoltre possibile tornare a onboarding con la falsa partenza (doc/00 022, `cancel`), mantenendo squadre ed esercizi. La pausa per-squadra (doc/00 021, postazione occupata) NON è uno stato globale: è uno stato per-squadra persistito su colonne di `team` (`paused_at_elapsed`/`paused_accum_ms`), misurato in unità di elapsed globale così da comporsi con la pausa globale. Lascia l'orologio globale in `running`

009. Il client riceve via SSE tick periodici col tempo globale e gli eventi di cambio stato (start, countdown, pausa, ripresa, chiusura esercizio, undo, stop). Tra un tick e l'altro il client può interpolare localmente per fluidità, ma il valore autoritativo resta quello del server

010. Le azioni dell'operatore (start, chiudi esercizio, undo, pausa, ripresa, stop) sono richieste REST; ognuna è una transazione persistita su PostgreSQL prima di essere riflessa nello stream SSE

011. Modello dati PostgreSQL (un allenamento per utente): utenti (`app_user`, con password cifrata bcrypt); catalogo esercizi globale e condiviso; allenamento dell'utente con stato e tempi (`workout.user_id` UNIQUE); squadre (nome, colore, membri) legate all'utente (`team.user_id`); ordine esercizi per squadra; parziali registrati (squadra, esercizio, tempo cumulativo). I parziali sono append-only così l'undo è la rimozione dell'ultimo. Membri, ordine esercizi e parziali restano partizionati per utente tramite la squadra di appartenenza

012. Al boot il server legge lo stato da PostgreSQL; se un allenamento era in running, riprende calcolando il tempo dall'istante d'inizio persistito (coerente con 001)

013. Deploy: singola istanza del server, nessuno scaling orizzontale. Lo stato di tutti gli allenamenti è in un unico DB, partizionato per utente. PostgreSQL gira come servizio a parte con un volume di disco persistente; lo schema è applicato/aggiornato da Liquibase (doc/04-devops.md)

015. L'immagine opzionale di un esercizio è salvata come BYTEA nel DB (non su filesystem): il server resta stateless e non serve alcun volume file dedicato, sfruttando l'unico volume persistente già esistente (PostgreSQL). I byte non viaggiano mai nello snapshot SSE (ribroadcastato ~ogni secondo): lo snapshot porta solo `hasImage` + `imageVersion`, e i byte si scaricano on-demand da `GET /api/exercises/:id/image` con cache lunga invalidata via `?v=imageVersion`. L'upload arriva in base64 (client che ridimensiona/comprime), perciò il `bodyLimit` del server è alzato a 5 MB

014. Autenticazione via cookie di sessione httpOnly firmato (HMAC), scelto perché lo stream SSE (`EventSource`) invia i cookie automaticamente e non supporta header custom. Il cookie trasporta solo lo `userId` (firmato per integrità); la sessione è stateless (nessuna tabella di sessione) e sopravvive a restart/deploy perché il segreto è in env (`SESSION_SECRET`). Login con bcrypt (`bcryptjs`). Un hook globale Fastify (`onRequest`) respinge con 401 ogni richiesta priva di sessione valida, eccetto `/api/health` e `/api/auth/login`; lo `userId` risolto è propagato a tutta la logica di store e all'SSE, che invia a ciascun utente solo gli eventi del proprio allenamento. In dev il cookie non è `secure` (http); in prod sì (HTTPS dietro Caddy)