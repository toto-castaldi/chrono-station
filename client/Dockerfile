# Build context = repo root (serve shared/). Produce un'immagine Caddy
# che serve il client statico e fa da reverse proxy verso il server (doc/04-devops.md).
FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --workspace @chrono/client --include-workspace-root
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY client/ client/
RUN npm run build --workspace @chrono/client

FROM caddy:2-alpine
COPY client/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/client/dist /srv
