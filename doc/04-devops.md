001. CI/CD con GitHub Actions: ad ogni push su `main` parte la pipeline di build e deploy che aggiorna il server

002. La pipeline builda le immagini Docker (il server Node; il reverse proxy Caddy con il client React già buildato in static; l'immagine `migrate` con Liquibase e i changelog dello schema) e le pubblica su GitHub Container Registry (GHCR)

003. Dopo la pubblicazione, la pipeline si collega al server via SSH ed esegue `docker compose pull && docker compose up -d`: aggiorna i container alle nuove immagini con pull + restart, senza buildare in produzione

004. Il server è una macchina Linux che esegue tutto tramite Docker Compose

005. Lo stack compose comprende: il container PostgreSQL (`db`); un container one-shot Liquibase (`migrate`) che aggiorna lo schema all'avvio; il container del server Node; un container Caddy che serve il client statico, inoltra API e SSE al server e gestisce HTTPS con certificati automatici

006. Caddy è configurato per non bufferizzare lo stream SSE (flush immediato verso il client), così i tick del tempo arrivano in tempo reale

007. Il database PostgreSQL risiede su un volume persistente (`chrono-pg`) montato nel container `db`: sopravvive ad aggiornamenti e restart dei container (coerente con doc/01-architecture.md 013)

008. I segreti del deploy (chiave SSH, host/utente del server, token per autenticarsi a GHCR dal server) e le credenziali PostgreSQL (`POSTGRES_*` nel file `.env` sul server) sono GitHub Actions secrets / file locale al server, mai nel repository

009. Le immagini (server, web, migrate) sono taggate con lo SHA del commit oltre che con `latest`, per tracciabilità e per poter fare rollback a una versione precedente

010. Le migrazioni dello schema sono gestite da Liquibase, non dal codice applicativo. Ad ogni `docker compose up -d` parte il servizio one-shot `migrate` (immagine Liquibase con i changelog dello schema): dipende dal `db` sano, esegue `liquibase update` (applica solo i changeset non ancora presenti — idempotente) e termina. Il `server` parte solo dopo che `migrate` è uscito con successo (`depends_on: service_completed_successfully`). Le migrazioni sono additive e preservano i dati: un allenamento in corso sopravvive a un deploy. In dev lo stesso `update` si lancia a mano con `npm run db:migrate` (doc/05-data-model.md, README)
