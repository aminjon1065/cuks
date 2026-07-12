# 04. Конвенции разработки

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Запрещены `any`, `@ts-ignore` (только `@ts-expect-error` с комментарием), enum (использовать `as const` объекты + union-типы).
- Именование: файлы `kebab-case.ts`, компоненты React `PascalCase.tsx`, хуки `use-*.ts`.

## REST API

- База: `/api/v1`. Ресурсы — существительные во множественном числе: `/api/v1/incidents`, `/api/v1/docflow/documents`.
- Методы: GET (чтение), POST (создание/действия), PATCH (частичное обновление), DELETE. Действия, не ложащиеся в CRUD: `POST /documents/:id/actions/sign`, `.../actions/register`.
- **Формат ошибки** (всегда):
```json
{ "error": { "code": "docflow.route.step_already_completed", "message": "человекочитаемо по-английски (для логов)", "details": {}, "requestId": "..." } }
```
  Коды — `module.entity.reason`, фронт маппит код → i18n-текст. HTTP-статусы: 400 валидация, 401 не авторизован, 403 нет прав, 404, 409 конфликт состояния, 422 бизнес-правило, 429 rate-limit.
- **Пагинация**: списки-таблицы — `?page=1&limit=50` (max 200), ответ `{ items, total, page, limit }`. Бесконечные ленты (чат, аудит, активность) — cursor: `?cursor=<uuidv7>&limit=50`, ответ `{ items, nextCursor }`.
- **Фильтры/сортировка**: `?sort=-created_at,subject`, фильтры плоскими параметрами `?status=active&type=flood`. Сложные выборки аналитики — POST с телом-фильтром.
- Все входные данные валидируются zod (body, query, params). Схемы — в `packages/shared/dto`, из них nestjs-zod DTO → Swagger автоматически.
- Ответы — camelCase JSON. Даты — ISO 8601 UTC. Деньги — строки (`"12500.50"`).

## WebSocket (Socket.IO)

- Namespace `/ws`. События: `module.entity.action` — `chat.message.created`, `tasks.card.moved`, `docflow.route.updated`, `notify.new`, `meet.ring`, `presence.changed`.
- Типы событий и payload — в `packages/shared/ws-events.ts` (единая карта имя→payload, типобезопасные emit/on).
- Сервер шлёт только в комнаты. Клиент вступает: `join` с типом+id, сервер проверяет права перед подпиской.
- Мутации — только через REST; WS — уведомления о изменениях (кроме typing/presence).

## База данных

- Схемы: `app` (бизнес), `gis` (пространственные слои), `audit` (журнал).
- Таблицы `snake_case` множественное число; колонки `snake_case`. PK `id uuid` (v7). Везде `created_at/updated_at timestamptz default now()`, у пользовательских данных `deleted_at` + `created_by`.
- FK — `on delete restrict` по умолчанию (осознанные `cascade` — только композиция: сообщение→реакции).
- Индексы создаются вместе с запросом, который их требует; для FTS — generated column `search tsvector` + GIN.
- Миграции: `pnpm db:generate` → просмотреть SQL глазами → закоммитить. Одна миграция — одна тема. Данные-миграции (справочники) — отдельными файлами со `-- data` комментарием.
- Никаких триггеров бизнес-логики (только `updated_at` и tsvector); логика — в сервисах.

## Frontend

- Данные сервера — только TanStack Query (`staleTime` осмысленный, инвалидация по мутациям и WS-событиям). Zustand — только UI-состояние (панели, выбор, черновики).
- Query keys: `[module, entity, params]` — фабрики ключей в `features/*/api/keys.ts`.
- Формы: react-hook-form + zodResolver с той же shared-схемой, что на бэке.
- Роуты — lazy per feature. Тяжёлые библиотеки (maplibre, echarts, livekit) — только в чанках своих модулей.
- Ошибки мутаций → toast с текстом по коду ошибки; ошибки загрузки → состояние error с retry.
- WS-обновления применяются через `queryClient.setQueryData`/инвалидацию — без дублирующих сторов.

## i18n

- Ключи: `module.screen.element` (`docflow.card.signButton`). Namespace-файл на модуль.
- Плейсхолдеры ICU: `{{count}}`, плюрализация через i18next.
- В коде — только `t('...')`. Новые ключи добавляются в `ru` (готовый текст) и `tg` (временно русский текст, помечается `// TODO tg`).

## Git

- Conventional Commits: `feat(docflow): route step escalation`. Scope = модуль.
- Ветки: `main` (стабильная), `feat/<phase>-<topic>`. Мерж — squash.
- CHANGELOG не ведём; история — коммиты + STATUS.md.

## Тесты

| Уровень | Инструмент | Что покрываем |
|---|---|---|
| Unit (api/worker) | Vitest | Сервисы с логикой: маршруты документов, нумерация, права, расчёты аналитики, крипто |
| e2e API | supertest + тестовая PG (testcontainers или compose) | Happy-path каждого эндпоинта + ключевые 403/422 |
| Unit (web) | Vitest + Testing Library | Хуки, сторы, сложные компоненты (формы маршрутов, канбан-dnd) |
| Smoke (web) | Playwright | На модуль: логин → ключевой сценарий (создать донесение, зарегистрировать документ, отправить сообщение…) |

Не гонимся за процентом покрытия — покрываем то, что страшно сломать. Фикстуры/фабрики — `packages/db/src/testing`.

## Логирование и аудит

- pino: `logger.info({ userId, entityId }, 'document registered')` — структурно, без интерполяции.
- Никогда не логировать: пароли, cookie, содержимое документов, приватные ключи.
- Аудит-хелпер: `audit.log({ actorId, action: 'docflow.document.sign', entityType, entityId, meta })` — перечень обязательных действий в спеке каждого модуля.

## Доступность и UX-минимумы

- Все интерактивы доступны с клавиатуры; фокус видим (`focus-visible`).
- Формы: label у каждого поля, ошибки под полем, submit по Enter, `aria-invalid`.
- Диалоги — shadcn Dialog (фокус-трап из коробки). Деструктивные действия — confirm с именем объекта.
- Контраст AA. Иконки-кнопки — с `aria-label` и tooltip.
