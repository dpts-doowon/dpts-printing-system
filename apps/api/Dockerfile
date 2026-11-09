# Contexto de build: a raiz do repositório.  docker build -f apps/api/Dockerfile -t doowon-traceability/api:TAG .
# PROVISÓRIO (homologação): imagem única com as dependências de produção; a versão final depende de D-002 a D-004.
FROM node:22-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @doowon/api... \
 && pnpm -F @doowon/api... build \
 && pnpm install --frozen-lockfile --prod --filter @doowon/api...

FROM node:22-slim

WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
