# syntax=docker/dockerfile:1
# Production images for the CUKS monorepo (docs/08-deployment.md, task 7.1). One build stage compiles
# the whole workspace; the api / worker / caddy runtime targets are selected via `target:` in
# compose.prod.yaml. The built repo is copied whole into the api/worker images (not pruned) so the same
# image can run drizzle-kit migrations — image size is traded for a simpler single-server deploy.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=cuks-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build

# --- API (NestJS + Fastify) ---
FROM node:22-slim AS api
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 3000
# Health endpoint (docs/08 §monitoring): /api/health.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

# --- Worker (BullMQ consumers; needs GDAL/ogr2ogr for geo-import) ---
FROM node:22-slim AS worker
RUN apt-get update \
  && apt-get install -y --no-install-recommends gdal-bin \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
CMD ["node", "apps/worker/dist/main.js"]

# --- Caddy edge with the SPA baked in ---
FROM caddy:2.8-alpine AS caddy
COPY --from=build /repo/apps/web/dist /srv/web
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
