# 03. Структура монорепозитория

```
cuks/
├── CLAUDE.md, README.md, docs/
├── package.json  pnpm-workspace.yaml  turbo.json  .npmrc
├── .env.example                      # исчерпывающий список переменных
├── apps/
│   ├── web/                          # Vite + React SPA
│   │   ├── index.html  vite.config.ts
│   │   ├── public/fonts/             # Inter (self-hosted, woff2)
│   │   └── src/
│   │       ├── app/                  # входная точка, провайдеры, роутер, layout shell
│   │       │   ├── router.tsx        # все маршруты (lazy по модулям)
│   │       │   ├── providers.tsx     # Query, i18n, Theme, Socket, Ability
│   │       │   └── shell/            # Sidebar, Topbar, CommandPalette, NotificationsPopover
│   │       ├── features/             # по модулям — зеркалит backend
│   │       │   ├── auth/  dashboard/  gis/  incidents/  analytics/
│   │       │   ├── docflow/  files/  tasks/  chat/  meet/  admin/  settings/
│   │       │   │   └── <feature>/
│   │       │   │       ├── api/      # хуки TanStack Query поверх packages/shared DTO
│   │       │   │       ├── components/
│   │       │   │       ├── pages/    # страницы-маршруты
│   │       │   │       └── stores/   # zustand, если нужен
│   │       ├── lib/                  # apiClient (fetch-обёртка), socket, utils, hooks
│   │       ├── locales/ru/*.json  locales/tg/*.json   # namespace = модуль
│   │       └── styles/globals.css    # tailwind + css-переменные токенов
│   ├── api/                          # NestJS (Fastify)
│   │   └── src/
│   │       ├── main.ts  app.module.ts
│   │       ├── common/               # guards, interceptors, filters, decorators, zod-pipe
│   │       ├── config/               # zod-валидация env
│   │       └── modules/
│   │           ├── auth/  users/  org/  admin/  audit/  notifications/  search/  links/
│   │           ├── files/  gis/  incidents/  analytics/
│   │           ├── docflow/  signatures/  tasks/  chat/  meet/
│   │           │   └── <module>/
│   │           │       ├── <module>.module.ts  <module>.controller.ts  <module>.service.ts
│   │           │       ├── dto/      # re-export из packages/shared + серверные
│   │           │       ├── events/   # доменные события
│   │           │       └── <module>.gateway.ts   # если есть WS
│   └── worker/                       # NestJS standalone (BullMQ processors)
│       └── src/queues/{av-scan,preview,text-extract,geo,notifications,email,deadlines,retention,recordings}/
├── packages/
│   ├── db/                           # drizzle: schema + миграции + клиент
│   │   ├── src/schema/               # по модулю на файл: core.ts, files.ts, gis.ts, docflow.ts, ...
│   │   ├── src/client.ts  drizzle.config.ts
│   │   └── migrations/               # *.sql — только через drizzle-kit generate
│   ├── shared/                       # без зависимостей от react/nest
│   │   └── src/{dto,permissions,constants,ws-events,utils}/
│   ├── ui/                           # дизайн-система
│   │   └── src/{components,tokens,icons}/   # shadcn-компоненты + собственные
│   └── config/                       # eslint-config, tsconfig-base, tailwind-preset
├── infra/
│   ├── docker/
│   │   ├── compose.dev.yaml          # только инфраструктура (pg, redis, minio, livekit, martin, geoserver, clamav, maildev)
│   │   ├── compose.prod.yaml         # всё, включая api/web/worker/caddy
│   │   ├── Caddyfile
│   │   ├── livekit/config.yaml  egress.yaml
│   │   ├── martin/config.yaml
│   │   └── api.Dockerfile  web.Dockerfile  worker.Dockerfile  # worker: +gdal-bin
│   ├── scripts/{backup.sh,restore.sh,seed-geo.sh}
│   └── basemap/                      # PMTiles-файл региона (в .gitignore, скачивается скриптом)
└── .github/workflows/ci.yaml         # или Gitea Actions: lint+typecheck+test+build
```

## Правила

- **Зеркальность**: фича на фронте = модуль на бэке = файл схемы в db = namespace в locales = раздел прав в shared/permissions. Одинаковые имена.
- **Направление зависимостей**: `apps/*` → `packages/*`; `packages/shared` ни от чего не зависит; `packages/ui` → shared; `packages/db` → shared. Между apps импортов нет.
- **DTO единожды**: zod-схема в `packages/shared/dto`, из неё — тип для фронта и nestjs-zod DTO для бэка.
- **Схема БД**: `packages/db/src/schema/*.ts` — единственный источник; pg-схемы `app`, `gis`, `audit` задаются в определениях таблиц.
- Пути-алиасы: `@cuks/shared`, `@cuks/db`, `@cuks/ui`, внутри web — `@/`.

## Скрипты корневого package.json

```jsonc
{
  "dev": "turbo dev",                    // web:5173, api:3000, worker
  "build": "turbo build",
  "typecheck": "turbo typecheck",
  "lint": "turbo lint",
  "test": "turbo test",
  "e2e": "pnpm --filter web e2e",
  "db:generate": "pnpm --filter @cuks/db generate",
  "db:migrate": "pnpm --filter @cuks/db migrate",
  "db:seed": "pnpm --filter @cuks/db seed"
}
```

Turbo: `build` зависит от `^build`; `dev` — persistent; кэш для build/lint/typecheck/test.

## Env (главное; полный список — .env.example)

`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT/KEY/SECRET`, `SESSION_SECRET`, `LIVEKIT_URL/API_KEY/API_SECRET`, `SMTP_URL`, `APP_ORIGIN`, `GEOSERVER_URL/ADMIN_PASSWORD`, `MARTIN_URL`, `CA_KEY_PATH` (ключ внутреннего УЦ), `TZ=Asia/Dushanbe`.
