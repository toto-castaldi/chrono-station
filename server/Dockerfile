# Build context = repo root (serve shared/). Vedi .github/workflows/deploy.yml
FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --workspace @chrono/shared --workspace @chrono/server --include-workspace-root
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
RUN npm run build --workspace @chrono/server

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --workspace @chrono/server --include-workspace-root --omit=dev
COPY --from=build /app/server/dist server/dist
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
