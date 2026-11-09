# Contexto de build: a raiz do repositório.
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://API_HOST -t doowon-traceability/web:TAG .
# NEXT_PUBLIC_API_URL é gravada na compilação: use uma imagem por endereço de API.
FROM node:22-slim AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "Informe --build-arg NEXT_PUBLIC_API_URL" && exit 1)
RUN pnpm install --frozen-lockfile --filter @doowon/web... \
 && pnpm -F @doowon/web... build \
 && pnpm install --frozen-lockfile --prod --filter @doowon/web...

FROM node:22-slim
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
EXPOSE 3000
WORKDIR /repo/apps/web
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
