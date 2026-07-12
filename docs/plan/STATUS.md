# STATUS — журнал прогресса

> Обновляется ИИ-агентом в конце каждой сессии. Единственный источник правды о состоянии кода.

## Текущее состояние

- **Фаза**: 0 (Фундамент) — в работе
- **Последняя сессия**: 2026-07-12 — задача 0.5
- **Ветка**: main

## Прогресс по фазам

Чекбоксы задач — в `ROADMAP.md` (агент отмечает их там). Здесь — сводка:

| Фаза              | Статус                       | Принята заказчиком |
| ----------------- | ---------------------------- | ------------------ |
| 0 Фундамент       | 🟡 в работе (0.1–0.5 готовы) | —                  |
| 1 Файлы           | ⬜                           | —                  |
| 2 ГИС/аналитика   | ⬜                           | —                  |
| 3 Документооборот | ⬜                           | —                  |
| 4 Задачи          | ⬜                           | —                  |
| 5 Чат             | ⬜                           | —                  |
| 6 Звонки          | ⬜                           | —                  |
| 7 Hardening       | ⬜                           | —                  |

## Журнал сессий

<!-- Новые записи СВЕРХУ. -->

### 2026-07-12 — Фаза 0: задача 0.5 (RBAC — роли, скоупы, ACL)

**Сделано** (машинерия `@RequirePermission`/`PermissionGuard`/CASL/таблицы — из 0.4; здесь — API и хелперы):

- **Roles CRUD** (`RolesService`): список ролей с правами, создание кастомной роли, изменение
  (имя + матрица permissions), soft-delete. Системные роли — read-only/неудаляемые.
- **Назначения** (`RoleAssignmentsService`): назначение роли пользователю с опциональным
  скоупом-подразделением (`user_roles.org_unit_id`), список по пользователю, отзыв.
- **ACL-хелперы** (`AclService`, level-3): grant/revoke/list + `check(user, resource, minLevel)`
  по трём типам субъектов (user/role/org_unit), уровни viewer<editor<manager; суперадмин — bypass.
- **Скоупы** (`ScopeService`, level-2): `getAccessibleOrgUnits(user, permission)` — глобально или
  список подразделений с раскрытием поддерева через materialized `path` (для фильтров в модулях).
- **Контроллер** `/api/v1/admin/{permissions,roles,role-assignments}` — все под
  `@RequirePermission('admin.roles.manage')`. Каталог permissions отдаётся с группировкой по
  модулям (RU-тексты — на фронте через i18n).
- Матрица прав применяется **без перелогина** (permissions читаются на каждый запрос — решение 0.4).

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (37 тестов; +rbac-хелперы,
createRoleSchema). **Live**: непривилегированный `operator` (роль employee) → `/admin/roles` 403
`permission.denied`; админ (после enroll 2FA) — каталог 35, роли 7, создание роли, PATCH системной
роли → 403 `system_readonly`, назначение со скоупом → 201, отзыв/удаление → 200.

**Отложено**: ACL/scope применяются в сервисах модулей по мере их появления (docs/05 §3 «правила —
в спеках модулей»); org_unit-субъект ACL сопоставляется с прямыми подразделениями пользователя
(предки/поддерево ACL — при нужде).

### 2026-07-12 — Фаза 0: задача 0.4 (аутентификация и авторизация)

**Сделано:**

- **Сессии (Redis)**: 256-битный id, cookie `cuks_session` (httpOnly/SameSite=Lax/Secure в prod),
  скользящий TTL 12ч / 30д «запомнить», лимит 10 сессий на пользователя (вытеснение старейшей),
  список/отзыв сессий. **CSRF**: double-submit cookie `cuks_csrf` + заголовок `X-CSRF-Token` +
  проверка Origin.
- **Логин**: argon2id-проверка, **lockout** (5 неудач/15 мин по username и IP), **rate-limit**
  `/auth/login` 10 rpm/IP, generic-ошибка на неверные данные, блок заблокированных.
- **TOTP**: setup/confirm/disable (otplib), секрет — AES-256-GCM at rest (`node:crypto`),
  10 одноразовых backup-кодов (sha256 в `app.totp_backup_codes`, миграция 0002), обязателен для
  ролей `admin.*`/`docflow.sign`/`gis.pg.access` (нельзя выключить).
- **Force-change**: `must_change_password` блокирует все маршруты, кроме `@AllowDuringPasswordChange`
  (me/password/logout).
- **Guards (глобальные, по порядку)**: SessionGuard → PasswordChangeGuard → CsrfGuard →
  PermissionGuard (`@RequirePermission` через CASL). `@Public` для login/health.
- **CASL ability** в `@cuks/shared` (общая FE/BE): каталог permissions + роли-шаблоны; permissions
  читаются на каждый запрос (мгновенный отзыв прав/сессий).
- **`GET /auth/me`**: профиль + сериализованные ability-правила + орг-контекст + флаги totp/force.
- **Стандартный конверт ошибок** `{ error: { code, message, details, requestId } }` (глобальный
  ExceptionFilter + zod-пайп) — закрыт [P2] из ревью 0.1–0.2.
- Эндпоинты: `POST /auth/login|logout|logout-all|password|totp/setup|totp/confirm|totp/disable`,
  `GET /auth/me|sessions`, `DELETE /auth/sessions/:id` (все под `/api/auth/*`, version-neutral).

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (30 тестов; +ability, crypto
round-trip, password argon2, auth.login-ветки). **Live (реальные Redis+PG)**: неверный пароль→401,
логин→200+cookies, `/auth/me`→superadmin, force-change→403, CSRF без токена→403, чужой Origin→403,
смена пароля→200, logout→401; **TOTP**: setup→confirm(10 кодов)→логин без кода→401→логин с кодом→200,
суперадмин не может выключить 2FA→422.

**Отложено**: полная per-route rate-limit матрица docs/09 (auth done; остальное — [P2] ниже);
persist аудита в БД — 0.11; `nestjs-zod` не берём (свой zod-пайп для контроля формата ошибок).

**Ревью (adversarial, security-focused).** Прогнан ревью auth против docs/05 §1 + docs/09; 11 находок
исправлены (2 критичных):

- **[critical]** `trustProxy: true` → клиент мог подделать `X-Forwarded-For` и обойти все per-IP
  защиты. Теперь `TRUST_PROXY` из env (по умолчанию — не доверять; в prod — число хопов/подсеть).
- **[critical]** обязательная 2FA для привилегированных ролей не форсилась. Добавлен
  `TotpEnrollmentGuard` + `@AllowDuringTotpEnrollment`: без включённой 2FA привилегированный
  пользователь заперт на me/logout/totp-setup/confirm.
- **[desirable]** user-enumeration: всегда выполняется argon2 (dummy-hash для несуществующего
  пользователя, тайминг); статус `blocked` раскрывается только после верного пароля.
- **[desirable]** `recordFailure` теперь `await` (не fire-and-forget); rate-limit вынесен в
  `ThrottleGuard` на все чувствительные `/auth/*` POST (login/password/totp-confirm/totp-disable).
- **[desirable]** TOTP replay: `verifyForLogin` хранит последний использованный шаг в Redis, тот
  же код нельзя применить дважды. Ключ шифрования: `ENCRYPTION_KEY` обязателен в prod (zod-refine).
- **[minor]** атомарное потребление backup-кода (единый UPDATE ... WHERE used_at IS NULL RETURNING);
  атомарный prune+evict сессий (Lua); скользящий cookie (re-issue на каждый ответ, interceptor).

Проверено live: подделка XFF не создаёт новых per-IP корзин (lockout сработал на 6-й попытке
с разными XFF); enrollment-гейт запирает привилегированного пользователя без 2FA на служебных
маршрутах (me/totp-setup доступны, sessions — 403).

### 2026-07-12 — Фаза 0: задача 0.3 (ядро БД, миграция, сиды)

**Сделано:**

- **Схема `app`** (Drizzle, `packages/db/src/schema/`, разбита по доменам): `users`, `org_units`
  (materialized `path`), `positions`, `user_positions`, `roles`, `role_permissions`, `user_roles`
  (nullable `org_unit_id` скоуп, UNIQUE NULLS NOT DISTINCT), `resource_acl`, `dictionaries`.
  Конвенции 04: uuidv7 PK (клиентская генерация), timestamptz, soft-delete `deleted_at`,
  `created_by → users` (restrict), FK on delete restrict (cascade — только `role_permissions`),
  CHECK-констрейнты на enum-поля, индексы под запросы.
- **Enum-словарь** в `@cuks/shared/enums` (единый источник для БД и фронта) + **каталог
  permissions и роли-шаблоны** в `@cuks/shared/permissions` (docs/05 §4–5) + `ARGON2_OPTIONS`.
- **Первая миграция** `0000_*.sql` (drizzle-kit generate, просмотрена глазами) — `CREATE SCHEMA app`
  + 9 таблиц.
- **Сиды** (`pnpm db:seed`, идемпотентные, onConflictDoNothing): суперадмин `admin`
  (argon2id, `must_change_password`, временный пароль из `SEED_ADMIN_PASSWORD`), 7 ролей-шаблонов
  + 70 permission-строк, орг-скелет из 10 узлов (docs/05 §2, фикс. id + materialized path),
  18 записей справочников (уровни ЧС, типы документов, категории корреспондентов, стартовые виды
  ЧС). `--demo` — заглушка (позже).

**Тесты/проверка:** `typecheck/lint/format/test/build` — зелёные (13 тестов; +4 на целостность
каталога permissions). **Live:** поднят postgres, `db:migrate` + `db:seed` прошли; проверено:
корректные счётчики, admin→superadmin (global), argon2id-хэш, materialized-path дерева;
**идемпотентность** (повторный сид не дублирует) и **FK restrict** (удаление роли с назначением
блокируется) подтверждены на живой БД.

**Ревью (adversarial, multi-agent).** Прогнан ревью схемы/сидов против 04/05/07; 5 находок
исправлены (миграция `0001`, критичных нет):

- CHECK-констрейнты на enum-поля были только у 3 из 8 колонок → добавлены для `users.locale/theme`,
  `dictionaries.type`, `resource_acl.resource_type/subject_type` (теперь все 8).
- `users.username` и `roles.code` — unique-индексы сделаны **частичными** (`WHERE deleted_at IS NULL`),
  чтобы soft-delete не блокировал повторное использование логина/кода.
- `org_units.path` — индекс с `text_pattern_ops` (иначе `path LIKE 'предок.%'` для поддерева
  делал seq-scan при не-C collation).

Поведение проверено на живой БД: CHECK отклоняет неверный enum; повторное использование кода после
soft-delete проходит. `0000` не редактировался (инвариант миграций) — изменения в `0001`.

**Отложенные core-таблицы 07** (создаются вместе с их потребителем): `notifications`/
`notification_prefs` → 0.10; `audit_log`/`read_log` → 0.11; `files`/`file_versions` → фаза 1;
`correspondents` → фаза 3; `comments`, `entity_links`, `saved_filters`, `user_settings`,
`substitutions` → при первом использовании.

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
- 2026-07-12 — **0.3 создаёт только identity/org/RBAC/dictionaries-ядро**; остальные core-таблицы
  07 отложены к их потребителю (см. журнал). Причина: каждая таблица создаётся с реальным
  потребителем, чтобы не фиксировать форму без валидации.
- 2026-07-12 — **UUIDv7 генерируется на клиенте** (`uuidv7`, ADR-14) через `$defaultFn`, без
  PG-функции (в PG17 нет `uuidv7()`). Орг-скелет в сидах — с фиксированными UUID для
  идемпотентности и детерминированного `path`.
- 2026-07-12 — **Нечёткие права в ролях-шаблонах** (05 §5: «chat.*базовое*», «всё
  пользовательское») сведены к конкретным permission из каталога 05 §4 в
  `@cuks/shared/permissions`. Суперадмин = wildcard `*` (bypass — интерпретируется CASL в 0.5).
- 2026-07-12 — **`org_units.head_position_id` без FK** (иначе цикл org_units↔positions);
  целостность — на уровне приложения. Коды справочников — латиницей (стабильные ключи).
- 2026-07-12 — **Auth под `/api/auth/*` (version-neutral)**, как health — аутентификация редко
  версионируется. Спека 05 пишет `/auth/*`; фактически с префиксом `/api`.
- 2026-07-12 — **Permissions читаются на каждый запрос** (SessionGuard), не кэшируются в сессии —
  чтобы отзыв прав/сессии действовал мгновенно (docs/02 ADR-3). Оптимизация кэшем — при нужде.
- 2026-07-12 — **Свой `ZodValidationPipe`** вместо `nestjs-zod` — полный контроль над форматом
  ошибок (единый конверт), без завязки на версию плагина.
- 2026-07-12 — **`ENCRYPTION_KEY` опционален** (AES-256-GCM для TOTP-секретов); при отсутствии
  выводится из `SESSION_SECRET` (scrypt). В prod — задать отдельный ключ.
- 2026-07-12 — **Два пула PG**: отдельный маленький пул для health-проб (изоляция) и общий
  прикладной пул (`DbModule`). У обоих — обработчик ошибок пула.

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
- [P2] Rate-limit по docs/09 §1 реализован для всех чувствительных `/auth/*` POST (10 rpm/IP через
  `@Throttle`/`ThrottleGuard`). Полная матрица (мутации 120, чтение 600, загрузки 20, поиск 60;
  per-user) — вводится по мере появления эндпоинтов / в hardening (фаза 7). — apps/api.
- [P2] Стандартный конверт ошибок теперь подключён (глобальный ExceptionFilter) — прежний [P2]
  из ревью 0.1–0.2 закрыт.

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
- `uuidv7@^1.0.2` — генерация сортируемых UUIDv7 на клиенте (ADR-14); малый, без нативных биндингов.
- `argon2@^0.41.1` — хэширование паролей (argon2id, docs/05 §1). **Нативный биндинг** (node-gyp,
  собирается при install); используется сидом (и auth в 0.4). В списке стека docs/02.
- `@fastify/helmet@^13.0.1` — security-заголовки (docs/09 §1, добавлено при исправлении ревью 0.1–0.2).
- `@casl/ability@^6.7.2` — общая ability FE/BE (docs/02, docs/05 §3); в `@cuks/shared` и api.
- `@fastify/cookie@^11.0.2` — cookie-парсинг/установка (сессия + CSRF).
- `otplib@^12.0.1` — TOTP (RFC 6238), docs/05 §1.
- `drizzle-orm@^0.38.3` добавлен в `apps/api` (прямые запросы в UsersService/TotpService; strict
  node_modules pnpm требует явной зависимости).
