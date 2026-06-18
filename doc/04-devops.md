001. CI/CD con GitHub Actions: ad ogni push su `main` parte la pipeline di build e deploy che aggiorna il server

002. La pipeline builda le immagini Docker (il server Node; il reverse proxy Caddy con il client React già buildato in static) e le pubblica su GitHub Container Registry (GHCR)

003. Dopo la pubblicazione, la pipeline si collega al server via SSH ed esegue `docker compose pull && docker compose up -d`: aggiorna i container alle nuove immagini con pull + restart, senza buildare in produzione

004. Il server è una macchina Linux che esegue tutto tramite Docker Compose

005. Lo stack compose comprende almeno: il container del server Node e un container Caddy che serve il client statico, inoltra API e SSE al server e gestisce HTTPS con certificati automatici

006. Caddy è configurato per non bufferizzare lo stream SSE (flush immediato verso il client), così i tick del tempo arrivano in tempo reale

007. Il database SQLite risiede su un volume persistente montato nel container del server: sopravvive ad aggiornamenti e restart dei container (coerente con doc/01-architecture.md 013)

008. I segreti del deploy (chiave SSH, host/utente del server, token per autenticarsi a GHCR dal server) sono GitHub Actions secrets, mai nel repository

009. Le immagini sono taggate con lo SHA del commit oltre che con `latest`, per tracciabilità e per poter fare rollback a una versione precedente

010. Ad ogni aggiornamento di produzione il database SQLite viene droppato e ricreato se cambia la forma dello schema. Il server mantiene una versione di schema (`PRAGMA user_version`); all'avvio, se la versione persistita differisce da quella attesa dal codice, droppa e ricrea le tabelle. Non c'è migrazione dei dati: un eventuale allenamento in corso durante un deploy con cambio schema viene perso (accettabile, è single-user/single-workout). Senza cambio di schema il volume persistente preserva i dati (007)
