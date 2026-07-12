# STATUS — журнал прогресса

> Обновляется ИИ-агентом в конце каждой сессии. Единственный источник правды о состоянии кода.

## Текущее состояние

- **Фаза**: 0 (Фундамент) — в работе
- **Последняя сессия**: 2026-07-12 — задачи 0.1, 0.2
- **Ветка**: main

## Прогресс по фазам

Чекбоксы задач — в `ROADMAP.md` (агент отмечает их там). Здесь — сводка:

| Фаза              | Статус                       | Принята заказчиком |
| ----------------- | ---------------------------- | ------------------ |
| 0 Фундамент       | 🟡 в работе (0.1–0.2 готовы) | —                  |
| 1 Файлы           | ⬜                           | —                  |
| 2 ГИС/аналитика   | ⬜                           | —                  |
| 3 Документооборот | ⬜                           | —                  |
| 4 Задачи          | ⬜                           | —                  |
| 5 Чат             | ⬜                           | —                  |
| 6 Звонки          | ⬜                           | —                  |
| 7 Hardening       | ⬜                           | —                  |

## Журнал сессий

<!-- Новые записи СВЕРХУ. -->

### 2026-07-12 — Фаза 0: задачи 0.1–0.2

**Сделано:**

- **0.1 Монорепо.** pnpm 9.15 (через corepack, без глобальной установки) + Turborepo;
  workspace-пакеты `@cuks/{shared,db,ui,config}`, приложения `@cuks/{web,api,worker}`;
  цепочка tsconfig (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noUnusedLocals/Parameters`); ESLint 9 flat (общий конфиг в
  `packages/config`, запрет `any`/`@ts-ignore`/`enum`); Prettier; husky (pre-commit →
  lint-staged, commit-msg → commitlint); GitHub Actions CI (typecheck → lint →
  format:check → test → build).
- **0.2 Инфра + конфиг + health.** `infra/docker/compose.dev.yaml`: postgis 17-3.5, redis 7,
  minio, clamav, maildev — с healthcheck'ами и named-volumes. `.env.example` — исчерпывающий.
  Загрузка `.env` через dotenv (multi-path: cwd приложения + корень монорепо).
  API на NestJS 11 (Fastify): глобальный префикс `/api`, URI-версионирование (default `v1`),
  pino-логирование (redact cookie/authorization), Swagger на `/api/docs`; zod-валидация env
  (fail-fast при старте). Health-модуль: `GET /api/health` (liveness), `GET /api/health/ready`
  (проверка PG/Redis/MinIO, 200/503).
- Заготовки: `@cuks/shared` — DTO пагинации/курсора/ошибки/health, константы (timezone,
  пагинация, locales), permissions/ws-events. `@cuks/db` — drizzle-клиент + `checkDatabase()`,
  `drizzle.config.ts`. `@cuks/ui` — `cn()`. `@cuks/web` — Vite 6 + React 19 + Tailwind 4,
  placeholder-страница (полный shell — в 0.8).

**Тесты:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build` — всё
зелёное. Добавлено: shared 3 (пагинация), db 1 (клиент), api 4 (health unit + e2e
liveness/readiness), web 1 (smoke Testing Library). Playwright: конфиг + smoke-спека
(установка браузеров и прогон — в 0.14).

**Проверка вручную (live):** поднята dev-инфра (docker compose), скомпилированный API запущен:
`/api/health` → 200 `{status:"ok"}`; `/api/health/ready` → 200 при поднятой инфре
(`postgres/redis/minio: up`) и 503 при недоступной (корректный per-dependency up/down);
`/api/docs` (Swagger UI) → 200. Инфра остановлена (volumes сохранены).

**Ревью (adversarial, multi-agent).** Прогнан ревью скаффолда против спек; 7 подтверждённых
находок исправлены в этой же сессии:

- **[critical]** `packages/db/src/client.ts` — у pg `Pool` не было обработчика `error`: перезапуск
  Postgres/`pg_terminate_backend` → unhandled `'error'` → падение процесса API. Добавлен
  `pool.on('error', …)` (по умолчанию + пробрасываемый логгер).
- **[desirable]** health-пробы pg/redis не отменялись по таймауту (утечка соединений при «завис,
  но слушает» Postgres). Добавлены `statement_timeout` (pg) и `commandTimeout` (redis).
- **[minor]** гонка connect/ping в redis-пробе → ложный `down`. Упрощено до ленивого ping.
- **[desirable]** нет security-заголовков (docs/09 §1). Подключён `@fastify/helmet`:
  X-Frame-Options DENY, nosniff, Referrer-Policy same-origin (везде); CSP+HSTS — в prod.
- **[desirable]** Swagger отдавался и в prod. Теперь `/api/docs` — только вне production.
- **[minor]** pino redact расширен до `password`/`totp`/`set-cookie` (docs/09 §1).
- **[minor]** `bootstrap()` без `.catch` → добавлен явный лог+`exit(1)` при сбое старта.

**Коммиты:** phase-0 scaffolding + review fixes (см. `git log`).

## Принятые решения (отклонения/уточнения спек)

<!-- Формат: дата — решение — причина — какие доки затронуты -->

- 2026-07-12 — **pnpm через corepack**, без глобальной установки; версия закреплена в
  `packageManager`. Причина: вопрос заказчика «зачем pnpm». Инвариант pnpm сохранён (ADR-15);
  corepack (встроен в Node 22) снимает необходимость ручной установки. Затронуто: README.
- 2026-07-12 — **compose.dev.yaml на старте — только 5 сервисов** из чеклиста 0.2 (pg, redis,
  minio, clamav, maildev). LiveKit/Martin/GeoServer — в своих фазах (6, 2). Причина: минимальный
  dev-footprint. Расхождение с перечнем в `docs/03` осознанное (добавим по фазам).
- 2026-07-12 — **nestjs-zod отложен** до первого DTO (фаза 0.4); env валидируется прямым zod.
- 2026-07-12 — **Prettier не форматирует markdown** (docs — авторские спеки заказчика);
  format-глоб только `ts/tsx/js/mjs/json/yaml/css`.
- 2026-07-12 — **`@cuks/shared` и `@cuks/db` компилируются в CommonJS** (dist без
  `"type":"module"`); web потребляет их исходники через Vite alias. Причина: Nest (CJS)
  делает `require()` пакетов — избегаем ESM/CJS-конфликтов на рантайме.
- 2026-07-12 — **health readiness: 503 при status≠ok** (degraded/down), 200 при ok. Проверка
  MinIO — HTTP `/minio/health/live` (без aws-sdk на этом этапе).
- 2026-07-12 — **Vitest поднят до 3.x** (вместо 2.x) для совместимости с Vite 6 (единая копия
  vite в дереве). В рамках `docs/02` (там Vitest без версии).

## Известные проблемы / техдолг

<!-- Формат: [P1|P2|P3] описание — где — план -->

- [P3] Nest 11 при старте пишет деприкейт-варнинг `Unsupported route path: "/api/*"`
  (path-to-regexp v8), авто-конвертируется в `/api/{*path}` и работает. — apps/api (bootstrap/
  swagger) — пересмотреть при апгрейдах Nest.
- [P3] Образ `postgis/postgis:17-3.5` — только amd64; на Apple Silicon (arm64) запускается через
  эмуляцию (медленнее). Для dev приемлемо; прод-сервер — amd64. — infra/docker/compose.dev.yaml.
- [P3] Playwright: конфиг и smoke-спека есть, браузеры не установлены, e2e не в CI — включается
  в 0.14.
- [P2] Стандартный конверт ошибок `{ error: { code, message, details, requestId } }` (docs/04 §13)
  определён как тип в `packages/shared/dto/error.ts`, но глобальный ExceptionFilter и генерация
  `requestId` ещё не подключены — сделать с первыми реальными эндпоинтами (фаза 0.4). — apps/api.
- [P3] CSP из docs/09 §1 задаётся приложением только в prod (для JSON API); CSP самого SPA —
  на уровне Caddy (edge), реализуется в фазе деплоя (7). — apps/api/main.ts, infra/Caddyfile.

## Добавленные зависимости (сверх docs/02-stack.md)

<!-- Формат: пакет@версия — зачем — размер -->

- `dotenv@^16.4.7` — загрузка `.env` (multi-path); малый, без нативных биндингов. Используют api
  и `drizzle.config.ts`.
- `@fastify/static@^8.0.4` — требуется `@nestjs/swagger` для отдачи статики Swagger UI под
  Fastify-адаптером.
- `clsx@^2.1.1`, `tailwind-merge@^2.6.0` — для `cn()` (packages/ui); стандарт shadcn/ui (docs/02).
- Тулинг ESLint (packages/config): `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`,
  `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals` — в рамках «ESLint 9 flat».
- Dev-тулинг: `rimraf` (clean), `tsx` (запуск сидов), `@swc/core` + `unplugin-swc` (транспиляция
  для Nest+Vitest, **@swc/core — нативный бинарник**), `pino-pretty` (dev-логи).
