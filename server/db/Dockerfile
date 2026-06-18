# Immagine Liquibase con il changelog già dentro. In prod gira all'avvio
# (servizio `migrate` in docker-compose.yml) ed esegue `update` sullo schema.
# Build context = repo root. Vedi .github/workflows/deploy.yml e doc/04-devops.md.
FROM liquibase/liquibase:4.31-alpine
COPY server/db/changelog /liquibase/changelog
