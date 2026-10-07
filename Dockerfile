FROM oven/bun:1.3.10-slim@sha256:5d5863f35ad9b3acceee8dc134fb2b89f07831129eaeec81af2b19a23dabe3e0 AS base

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
COPY packages/state/package.json packages/state/
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
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg=7:7.1.5-0+deb13u1 \
    libsqlite3-0=3.46.1-7+deb13u2 \
    && rm -rf /var/lib/apt/lists/*

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
RUN for pkg in sqlite-vec-linux-x64 sqlite-vec-linux-arm64; do \
      [ -d node_modules/.bun/node_modules/$pkg ] && \
        ln -sf .bun/node_modules/$pkg node_modules/$pkg; \
    done; true
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/server/public
COPY --from=build /app/packages/db/src/migrations ./migrations

RUN mkdir -p /data && chown bun:bun /data

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/config/local.db
ENV VECTOR_DIR=/data/vector
ENV THUMBNAILS_DIR=/data/thumbnails

EXPOSE 3000
VOLUME ["/data"]
USER bun

WORKDIR /app/apps/server
CMD ["bun", "run", "dist/index.mjs"]
