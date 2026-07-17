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

# --- Backup (restic + pg_dump, scheduled via crond; docs/runbook-backup.md, task 7.2) ---
# Independent of the monorepo build. pg client MUST match the server major (postgis 17-3.5 -> 17),
# else pg_dump refuses ("server version newer than pg_dump"). Alpine 3.21 ships postgresql17-client.
FROM alpine:3.21 AS backup
RUN apk add --no-cache restic postgresql17-client bash coreutils findutils tzdata
ENV TZ=Asia/Dushanbe \
    RESTIC_REPOSITORY=/repo \
    BACKUP_STAGE_DIR=/staging
COPY infra/scripts/backup.sh infra/scripts/restore.sh infra/scripts/backup-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/backup-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/backup-entrypoint.sh"]
