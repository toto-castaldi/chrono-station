001. L'applicazione ha una interfaccia web ma lo stato di un allenamento è tutto server side. Reload di pagina, crash del tablet, o altre interazioni non volute sul client non fanno perdere informazioni su un allenamento in corso

002. Il client fa stream del tempo che passa dal server

003. ad ogni chiusura esercizio viene segnato il tempo parziale memorizzato sul server

004. l'applicazione è mono utilizzatore e gestisce un allenamento alla volta

005. Stack: server Node.js + TypeScript (Fastify); client SPA React + Vite + TypeScript; persistenza SQLite; comunicazione realtime dal server via SSE

006. Repository monorepo: `client/` (React), `server/` (Node), `shared/` (tipi TypeScript condivisi: modelli squadra, esercizio, stato allenamento, eventi)

007. Il server è l'unico orologio autoritativo. Non incrementa un contatore in un loop: memorizza l'istante d'inizio e gli intervalli di pausa, e calcola il tempo trascorso in funzione del wall-clock. Così il tempo è sempre ricostruibile dopo un riavvio

008. Lo stato dell'allenamento è una macchina a stati: onboarding → countdown → running ⇄ paused → finished

009. Il client riceve via SSE tick periodici col tempo globale e gli eventi di cambio stato (start, countdown, pausa, ripresa, chiusura esercizio, undo, stop). Tra un tick e l'altro il client può interpolare localmente per fluidità, ma il valore autoritativo resta quello del server

010. Le azioni dell'operatore (start, chiudi esercizio, undo, pausa, ripresa, stop) sono richieste REST; ognuna è una transazione persistita su SQLite prima di essere riflessa nello stream SSE

011. Modello dati SQLite (single-workout): catalogo esercizi; allenamento corrente con stato e tempi; squadre (nome, colore, membri); ordine esercizi per squadra; parziali registrati (squadra, esercizio, tempo cumulativo). I parziali sono append-only così l'undo è la rimozione dell'ultimo

012. Al boot il server ricostruisce lo stato in memoria leggendo SQLite; se un allenamento era in running, riprende calcolando il tempo dall'istante d'inizio persistito (coerente con 001)

013. Deploy: singola istanza, nessuno scaling orizzontale (lo stato è in-process e c'è un solo allenamento). Su hosting cloud SQLite richiede un volume di disco persistente, non un filesystem effimero