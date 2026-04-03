FROM oven/bun:1.3.10-alpine@sha256:32f1fcccb1523960b254c4f80973bee1a910d60be000a45c20c9129a1efcffee AS base

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/env/package.json packages/env/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/ui/package.json packages/ui/
COPY packages/vector/package.json packages/vector/
RUN bun install --frozen-lockfile

# --- Build ---
FROM deps AS build
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV VITE_SERVER_URL=""
RUN bun x turbo build

# --- Prune for server production deps ---
FROM base AS prune
RUN bun add -g turbo@^2
WORKDIR /app
COPY --from=deps /app .
RUN turbo prune server --docker

FROM base AS prod-deps
WORKDIR /app
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production

# --- Production ---
FROM base AS production
RUN apk add --no-cache ffmpeg=6.1.2-r2 sqlite-libs=3.49.2-r1

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=prod-deps /app/packages/vector/node_modules ./packages/vector/node_modules
RUN mkdir -p node_modules/@libsql && \
    for arch in linux-arm64-musl linux-arm64-gnu linux-x64-musl linux-x64-gnu; do \
      [ -d node_modules/.bun/node_modules/@libsql/$arch ] && \
        ln -sf ../.bun/node_modules/@libsql/$arch node_modules/@libsql/$arch; \
    done; true
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/server/public
COPY --from=build /app/packages/db/src/migrations ./migrations

RUN mkdir -p /data && chown bun:bun /data

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/local.db
ENV VECTOR_DB_DIR=/data/vector-data

EXPOSE 3000
VOLUME ["/data"]
USER bun

WORKDIR /app/apps/server
CMD ["bun", "run", "dist/index.mjs"]
