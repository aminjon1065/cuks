# STATUS — журнал прогресса

> Обновляется ИИ-агентом в конце каждой сессии. Единственный источник правды о состоянии кода.

## Текущее состояние

- **Фаза**: 0 (Фундамент) — в работе
- **Последняя сессия**: 2026-07-13 — задача 0.13
- **Ветка**: main

## Прогресс по фазам

Чекбоксы задач — в `ROADMAP.md` (агент отмечает их там). Здесь — сводка:

| Фаза              | Статус                       | Принята заказчиком |
| ----------------- | ---------------------------- | ------------------ |
| 0 Фундамент       | 🟡 в работе (0.1–0.13 готовы) | —                 |
| 1 Файлы           | ⬜                           | —                  |
| 2 ГИС/аналитика   | ⬜                           | —                  |
| 3 Документооборот | ⬜                           | —                  |
| 4 Задачи          | ⬜                           | —                  |
| 5 Чат             | ⬜                           | —                  |
| 6 Звонки          | ⬜                           | —                  |
| 7 Hardening       | ⬜                           | —                  |

## Журнал сессий

<!-- Новые записи СВЕРХУ. -->

### 2026-07-13 — Фаза 0: задача 0.13 (worker-каркас, BullMQ)

**Сделано** (по `docs/01` §Фоновые задачи, `docs/02` §Email; BullMQ producer в api, consumer в worker):

- **Shared** (`queues/`): контракт очередей — `QUEUE` (`email`/`deadlines`/`audit-maintenance`),
  `EmailJobData`, `DEFAULT_JOB_OPTIONS` (3 попытки, экспон. backoff, ограниченное хранение
  завершённых). Имена и пейлоады общие, чтобы api и worker не разъехались.
- **API (producer)**: `BullModule.forRootAsync` в `app.module`. `MailService` теперь **кладёт задачу
  в очередь `email`** вместо inline-nodemailer из 0.10 — интерфейс `send()` для вызывающих не изменился,
  best-effort сохранён (ошибка enqueue проглатывается+логируется, исходное действие не ломает). Юнит:
  enqueue + best-effort.
- **Worker (consumer)**: отдельное Nest-приложение (`createApplicationContext`), zod-валидация env на
  старте, `DbModule` (@Global, пул закрывается на shutdown-хуке). Процессоры: **email** (владеет
  nodemailer/SMTP; throw = ретрай с backoff; без `SMTP_URL` — логируемый no-op), **deadlines** (часовой
  repeatable-стаб; реальная логика overdue/эскалаций — с docflow/tasks), **audit-maintenance**
  (провижинит партиции `audit.audit_log` на текущий месяц + 2 вперёд, на старте и ежемесячно cron
  `0 3 1 * *`) — **закрывает автоматизацию партиций из 0.11**. Юнит: email-процессор (send + no-op).

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (api 50 тестов). **Live e2e**: полный
путь письма **api → worker → maildev** — enqueue в api, worker залогировал `email sent`, maildev принял
`no-reply@cuks.local -> admin@cuks.local`; **audit-partition cron отработал на старте**
(`audit_log partitions ensured (current month + 2 ahead)`); worker поднялся
(`Worker started — email, deadlines, audit-maintenance queues online.`). Сид-админ восстановлен, демо-
письмо не осталось.

**Adversarial-review**: воркфлоу упёрлось в session-limit (3 агента — ошибка, 0 находок,
**неинформативно**), поэтому провёл фокусный ручной проход по зонам риска: дедуп repeatable-джоб
BullMQ по `(name,pattern)` (нет накопления при рестартах), TZ-край audit-cron (месяц уже провижинен
как «+2» в прошлом прогоне, DEFAULT ловит остаток — потери строк нет), best-effort mail, закрытие
пула. Дефектов не найдено, правок кода не потребовалось.

**Решения**: (1) BullMQ-подключение задаётся как `connection: { url, maxRetriesPerRequest: null }`, а не
инстансом IORedis — bullmq пинит ioredis 5.10.1, установлен 5.11.1, инстанс-типы несовместимы; url-форма
обходит конфликт и работает. (2) `deadlines` — стаб (proof cron-обвязки); реальная детекция просрочек и
эскалации приедут с docflow/tasks. (3) Дроп старых партиций по retention (≥3 г) отложен — сейчас только
провижининг вперёд; авто-дроп добавим ближе к prod (концерн деплоя). (4) У worker свой пул PG (нужен
только audit-maintenance) и nodemailer-транспорт живёт в процессоре (api о SMTP больше не знает).

### 2026-07-13 — Фаза 0: задача 0.12 (админка v0)

**Сделано** (4 раздела по `docs/16`; исследование + adversarial-review прогнаны воркфлоу):

- **Users** (бэкенд был MISSING — построен): `modules/admin/admin-users.{service,controller}` +
  `user-identity` (translit-логин, короткое имя «И.О. Фамилия», одноразовый temp-пароль). Эндпоинты
  `/api/v1/admin/users` CRUD + block/unblock/reset-password/reset-totp — под `admin.users.manage`,
  всё аудируется. Create отдаёт логин+temp-пароль (mustChangePassword); block/reset рвут сессии и шлют
  WS `auth.forced_logout` (клиент выходит < сек). UI: список (поиск/статус), создание (показ пароля
  один раз), карточка с блокировкой/сбросами и назначением ролей.
- **Roles/Org/Audit** (бэкенды из 0.5/0.6/0.11): UI. Роли — матрица прав по модулям (системные —
  read-only + «скопировать как основу»). Оргструктура — дерево со счётчиками, CRUD подразделений/
  должностей, перенос. Аудит — фильтруемая таблица (action-префикс, период) + карточка события +
  экспорт CSV (постранично, без обрезки).
- **Инфраструктура фронта**: `features/admin` (queries на всё), i18n `admin` (ru + tg-заглушка),
  роуты `/app/admin/*` заменили ComingSoon, `useForcedLogout` в оболочке, `OrgUnitPicker` стал
  clearable. Разделы скрыты по правам (CASL `useVisibleByPermission`); сервер перепроверяет.

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (api 48 тестов). **Live e2e**:
вход админом (2FA) → **создание пользователя** `karimova.d` (+temp-пароль) → **вход по temp-паролю**
(`mustChangePassword:true`) — приёмка ✓; **блокировка** → вход заблокированного 403, self-block 400;
все 4 раздела рендерятся (тёмная тема), аудит показывает реальный след (admin.user.created/blocked с
ip из ALS). Демо-юзер `karimova.d` оставлен в БД.

**Adversarial-review** (воркфлоу 4×измерения → рефутация): 16 находок → 15 подтверждено, все
исправлены. Главное: **[HIGH] эскалация привилегий** — держатель `admin.users.manage` мог сбросить
2FA+пароль суперадмина (temp-пароль в ответе) и войти суперадмином. Починено: `assertMayManage` —
не-суперадмин не может действовать над суперадмином (по образцу delegation в role-assignments). Плюс
гард «последний суперадмин» в `revoke()`; постраничный CSV-экспорт (был обрез на 100); инвалидация
списка юзеров после смены ролей/должностей; сброс формы CreateUserDialog на всех путях закрытия;
i18n двух хардкод-строк; aria-label селектов; `OrgUnitPicker` clearable.

**Решения**: аудит-события юзеров — `admin.user.{created,updated,blocked,unblocked,password_reset,
totp_reset,deleted}`. Отложено (вне v0, в спеке 16-admin, но не фаза 0): CSV-импорт, transfer/
увольнение-визард, ЭЦП-сертификаты, квоты, справочники, настройки платформы, health, замещения,
read_log ДСП, DnD-перенос оргдерева (перенос — через пикер родителя).

### 2026-07-13 — Фаза 0: задача 0.11 (аудит-ядро)

**Сделано** (по `docs/07` §audit, `docs/09` §5; исследование прогнано understand-воркфлоу):

- **БД** (миграция `0005`, ручная): `audit.audit_log` — RANGE-партиции по месяцам на `created_at`,
  композитный PK `(id, created_at)`, индексы `(entity_type,entity_id)` + `(actor_id,created_at)` +
  **BRIN**(`created_at`), append-only. drizzle-kit не умеет `PARTITION BY`, поэтому таблица описана
  вручную в миграции, а тип-зеркало вынесено в `packages/db/src/unmanaged/audit-log.ts` (вне glob
  `src/schema/*`), чтобы дифф drizzle её не трогал. Идемпотентная функция создания партиций
  (`ensure_audit_log_partition`, границы через `make_timestamptz(...,'UTC')` — детерминированы, не
  зависят от session-TZ) + текущий месяц и 3 вперёд + DEFAULT-партиция (insert никогда не падает).
- **API**: `AuditService.log()` теперь пишет каждое событие в `audit.audit_log` (fire-and-forget;
  pino-строка — бэкап; сбой аудита не ломает исходное действие). Глобальный `RequestContextInterceptor`
  сеет `AsyncLocalStorage`-контекст (ip / user-agent / actorId) после guard'ов, поэтому 18 существующих
  вызовов `log()` не тронуты — событие всё равно полностью атрибутируется; явные значения приоритетнее.
  Read-API `GET /api/v1/admin/audit` (`admin.audit.view`) с фильтрами action(prefix)/actor/entity/период.
  Юнит-тесты: персист+обогащение+resilience, интерцептор, query.

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (api 40 тестов). **Live**: вход админом
→ смена пароля → включение 2FA; в `audit.audit_log` 4+ события; **события без явного ip/ua**
(`auth.password.changed`, `auth.totp.*`) получили `ip=127.0.0.1` и корректный `user_agent` **из
ALS-контекста** — интерцептор работает; read-эндпоинт отдаёт отфильтрованную ленту; строки попали в
июльскую партицию (`default: 0`) — маршрутизация партиций работает. Сид-админ восстановлен.

**Adversarial-review** (воркфлоу 4 измерения → рефутация): 4 находки → 0 подтверждено (все low,
рефутированы обоснованно). Одна (TZ-границы партиций, поднята 3/4 ревьюерами) — не баг (партиции
идеально стыкуются, DEFAULT ловит остаток), но применил hardening: границы привязаны к UTC через
`make_timestamptz`, устраняя хрупкость при возможном TZ-mismatch cron'а 0.13.

**Решения**: (1) `ip` хранится как `text` (не `inet`) — аудит не должен падать на нестандартном
значении. (2) Append-only на уровне **PG-роли** (REVOKE UPDATE/DELETE) — деплой-концерн (`docs/09`
§PG-role): в dev приложение = владелец БД, в prod — ограниченная роль; проверяется на pre-prod gate.
Приложение UPDATE/DELETE по аудиту нигде не делает. (3) Управление партициями (создание вперёд,
дроп старых по retention ≥3г) — за BullMQ-cron'ом фазы 0.13; сейчас месяц+3 вперёд + DEFAULT.
(4) `read_log` (ДСП-чтения) — отдельная таблица, появится с файлами/ДСП (фаза 1+).

### 2026-07-13 — Фаза 0: задача 0.10 (уведомления-ядро)

**Сделано** (по `docs/07`/`docs/16`; исследование фазы прогнано understand-воркфлоу):

- **БД** (миграция `0004`): `notifications` (user-scoped, индекс `(user_id,is_read,created_at desc)`)
  и `notification_prefs` (unique `(user_id,type_group,channel)`, check `inapp|email`). Идемпотентный
  demo-сид уведомлений админу.
- **Shared** (`notifications/`): группы `[system,docflow,tasks,chat,meet,incidents]`, каналы,
  критичные группы (in-app нельзя выключить) `[docflow,meet,incidents]`, `groupOfType()`; DTO;
  `notify.new` payload `{id,type,createdAt}`.
- **API** (`modules/notifications`): `NotificationsService.notify()` — единая точка входа: учитывает
  prefs (in-app критичных — всегда, email — по умолчанию вкл), пишет in-app строку + шлёт `notify.new`
  (RealtimeService), отправляет email best-effort. Эндпоинты `/api/v1/notifications` (лента, unread-count,
  read/:id, read-all, prefs GET/PATCH) — без permission-гейта, всё скоупится на вызывающего. `MailService`
  (`common/mail`) — nodemailer/`SMTP_URL` за тонким фасадом (0.13 переведёт на BullMQ); нет SMTP —
  логируемый no-op. `NotificationsModule` — `@Global`, чтобы AuthService слал `system.account.password_changed`
  без цикла модулей. Юнит-тесты сервиса + prefs-lock.
- **Web** (`features/notifications`): колокольчик-поповер (бейдж непрочитанных, лента, «прочитать все»),
  страница уведомлений, матрица настроек (критичные in-app-ячейки заблокированы, оптимистичное сохранение);
  `notify.new` инвалидирует ленту и поднимает тост. Toast + Switch добавлены в `packages/ui`. Текст и
  относительное время (`Intl.RelativeTimeFormat`) локализуются на клиенте по `type`.

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (api 32 теста). **Live e2e** (обе темы):
вход админом (2FA) → на дашборде бейдж «3» (сид+password_changed); поповер — локализованные заголовки по
`type`, иконки по группе, относительное время «5 минут назад», точки непрочитанного; страница; матрица —
lock-иконки у docflow/meet/incidents in-app, тумблеры сохраняются; **live `notify.new`** (смена пароля →
бейдж 3→4→5 + тост «Новое уведомление»); **email → maildev** (лог maildev `no-reply@cuks.local ->
admin@cuks.local`); отключение SMTP — action не падает. Тёмная тема ок. Сид-админ восстановлен после теста.

**Adversarial-review** (воркфлоу: 4 измерения → рефутация): 6 находок → 4 подтверждены, все low/medium,
без корректности/безопасности — исправлены: (1) i18n aria-label пагинации; (2) оптимистичное сохранение
prefs (onMutate+rollback) вместо пессимистичного + снят глобальный disable свитчей; (3) error-тост
`role="alert"` вместо `status`.

**Решения** (docs/07 молчит — минимальные): группа = первый сегмент `type`; email по умолчанию вкл,
критичность форсит только in-app (не email); контент уведомления (`title/body`) — данные продюсера
(англ. фолбэк в БД, локализация на клиенте по `type`), не UI-хардкод; email отправляется inline сейчас,
в 0.13 уедет за BullMQ-очередь; `notification_prefs` имеет `updated_at` + unique-ключ.

### 2026-07-13 — Фаза 0: задача 0.9 (Socket.IO)

**Сделано** (realtime-каркас по `docs/01` §Realtime):

- **Shared** (`ws-events`): `WS_NAMESPACE='/ws'`, хелперы комнат `wsRooms` (`user/channel/board/
  entity`), событие `connection.ready`.
- **API** (`modules/events`): `EventsGateway` на namespace `/ws` — авторизация handshake по той
  же session-cookie (парсинг заголовка → `SessionService.get` → проверка активного/незаблок.
  пользователя), затем `join user:{id}`; сокет без сессии/заблок. — дисконнект. `RealtimeService`
  — развязанный publish-API (`emitToUser`/`emitToRoom`), который инжектят другие модули; гейтвей
  биндит живой сервер в `afterInit`. `RedisIoAdapter` (`common/adapters`) — `@socket.io/redis-adapter`
  на двух дублях ioredis + CORS на APP_ORIGIN с credentials; ставится в `main.ts`
  (`useWebSocketAdapter`) до `listen`.
- **Web** (`lib/socket.ts`): `SocketProvider` (одно `/ws`-соединение `withCredentials`,
  смонтирован внутри авторизованной оболочки — коннектится после входа, рвётся при выходе) +
  `useSocket`/`useSocketEvent` с типизированными событиями. Vite-proxy `/socket.io` (ws) → :3000.

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (api +8 тестов: parseCookieHeader,
handleConnection happy/‌no-cookie/‌stale/‌blocked, RealtimeService routing; сборка web 682 КБ).
**Live**: сокет-эндпоинт отвечает; скриптовый socket.io-client с валидной session-cookie →
`connect` + `connection.ready {userId}` (комната присвоена); без cookie → сервер дисконнектит
(`unauthorizedRejected`); vite-proxy `/socket.io` через :5174 отдаёт handshake.

**Примечание**: глобальные HTTP-guard'ы (SessionGuard и пр.) не мешают, т.к. в гейтвее пока нет
`@SubscribeMessage`-хендлеров; когда появятся — нужен WS-совместимый guard (проверять
`context.getType()`), иначе HTTP-guard сломает WS-контекст. Presence (`presence.changed`) — в 0.10.

### 2026-07-13 — Фаза 0: задача 0.8 (App Shell, `apps/web`)

**Сделано** (каркас SPA по `docs/03`/`docs/06` §3; продуктовые модули — заглушки):

- **Провайдеры/роутер** (`src/app`): `Providers` (TanStack Query, i18next, тема, Tooltip),
  `createBrowserRouter`. `AuthGate` — единый шлюз: по `GET /auth/me` вычисляет, где сессии
  дозволено находиться (`login`/`force-password`/`enroll-totp`/`app`) и редиректит; поток
  нельзя пропустить.
- **Оболочка** (`src/app/shell`): сворачиваемый `Sidebar` (пункты + раздел «Администрирование»
  по правам через CASL; коллапс в localStorage), `Topbar` (заголовок раздела, поиск→Cmd+K,
  колокольчик-заглушка, меню профиля с выходом), `CommandPalette` (cmdk, навигация, Cmd+K),
  `NotificationsPopover` (каркас до 0.10). Пустые/заглушечные экраны 403/404/ComingSoon.
- **Auth-экраны** (`src/features/auth`): логин (поле 2FA появляется по `totp_required`),
  принудительная смена пароля, **включение TOTP** (setup→код→резервные коды). Хуки на TanStack
  Query; TOTP-setup смоделирован как `useQuery` (один фетч, кэш) — чтобы StrictMode-ремоунт не
  терял секрет.
- **lib**: `api-client` (относительный `/api`, credentials, CSRF double-submit, разбор
  конверта ошибок → `ApiError`), `i18n` (ru + tg-заглушка, ключи английские, неймспейсы по
  модулям), `theme`/`ui-store` (zustand+persist), `ability` (CASL из `abilityRules` + `useCan`).
- Dev-showcase из 0.7 удалён; `App` рендерит роутер. Vite-proxy `/api`→:3000 уже был.

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (web +8 тестов: login-render,
theme-логика, api-client CSRF/envelope; api +3 на идемпотентность TOTP-setup; сборка web 640 КБ).
**Live e2e в браузере** (обе темы): полный вход `admin` → смена пароля → **включение 2FA** (код
посчитан из секрета, 200 + резервные коды) → дашборд; сайдбар (коллапс сохраняется), Cmd+K
(открытие/фильтр/выбор/Esc), переключатель темы (dark↔light, сохраняется), 404, меню профиля,
выход → /login. Сид-админ восстановлен в исходное состояние после теста.

**Найденные и исправленные проблемы:**

- **[critical, api] TOTP-setup был не идемпотентен** — каждый вызов генерировал новый секрет и
  перезаписывал pending, а UI показывал старый ⇒ введённый код не совпадал с проверяемым, и
  включение 2FA срывалось при любом повторном запросе (StrictMode/ретрай/вторая вкладка).
  Починено: `setupTotp` переиспользует неподтверждённый секрет, новый — только если pending нет
  (`fix(api)`, +3 unit-теста). Поймано при live-проверке экрана включения.
- **[web] useMutation в эффекте терял данные под StrictMode** — секрет копировался в локальный
  стейт через `mutate`-onSuccess и пропадал при ремоунте. Переведено на `useQuery` (кэш).

**Решения**: роутер — `react-router-dom` v7 (SPA-роутер из `docs/03`); command-палитра — `cmdk`
(примитив Command из design-system §4). **Известные хвосты**: (1) на экране включения 2FA пока
только текстовый секрет для ручного ввода — QR-код отложен (нет одобренной qr-либы, бинарники не
тянем); (2) web-бандл одним чанком 640 КБ — route-level lazy отложен до появления реальных
модульных страниц; (3) Inter-woff2 не self-hosted (нет бинарников) — фолбэк `system-ui`,
`@font-face` добавится при поставке шрифтов.

### 2026-07-13 — Фаза 0: задача 0.7 (дизайн-система, `packages/ui`)

**Сделано** (библиотека компонентов + токены по `docs/06`; продуктовых экранов ещё нет):

- **Токены** (`styles/index.css`): семантические CSS-переменные для светлой (`:root`) и тёмной
  (`.dark`) тем — фон/поверхности/границы/текст, `primary`, статусы (success/warning/danger/info),
  уровни ЧС `sev-1..5`, радиусы, тени. Через Tailwind v4 `@theme inline` они маппятся в утилиты
  (`bg-primary`, `text-sev-3`, …), поэтому тема переключается в рантайме без `dark:`-вариантов.
- **Базовые примитивы** (shadcn-паттерн на Radix): button (CVA-варианты + `asChild`), input, badge,
  label, skeleton, table, dialog, sheet, popover, avatar, tooltip.
- **Составные** (минимум из ROADMAP + сверх): `StatusBadge`/`SeverityBadge`, `PageHeader`,
  `EmptyState`, `ConfirmDialog` (имя объекта на виду), `UserChip`, `UserPicker`/`OrgUnitPicker`
  (поиск/дерево в поповере), `FilterBar`, `SidePanel`, `DataTable` на TanStack Table
  (сортировка/выбор строк/пагинация + встроенные loading-skeleton / empty / error-retry).
- **Web-обвязка**: токены импортируются в Tailwind-вход (`globals.css`), пакет и его `styles.css`
  резолвятся на исходники через Vite-alias; временный dev-showcase (`apps/web/src/dev/UiShowcase`)
  рендерит все компоненты для визуальной проверки (заменяется реальной i18n-оболочкой в 0.8).

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (+7 smoke-тестов Vitest/Testing
Library в `@cuks/ui`; сборка web-CSS 22 КБ). **Скриншоты двух тем** (`docs/06` §8) сняты в браузере:
светлая и тёмная — кнопки/бейджи/уровни ЧС/пикеры/DataTable/skeleton/EmptyState/ConfirmDialog
рендерятся корректно, оверлеи (Dialog/Sheet) портализуются и читаемы в обеих темах.

**Ревью / найденные и исправленные проблемы:**

- **[critical] Утилиты не генерировались.** Классы `bg-primary`/`text-primary-fg`/тона бейджей
  используются только внутри `@cuks/ui`, а автоскан контента Tailwind v4 не доходил до пакета —
  кнопки/бейджи рендерились без заливки (прозрачные). Починено `@source '..'` в `styles/index.css`
  (пакет регистрирует свои исходники для сборки потребителя). Проверено в dev (HMR) и в
  прод-сборке (CSS 8→22 КБ, `.bg-primary`/`.bg-danger`/`sev-*` присутствуют). Поймано именно
  обязательной визуальной проверкой из §8.
- **[i18n] Хардкод строк в библиотеке.** Убраны русские литералы из компонентов
  (`emptyLabel`/`resetLabel`, sr-only «Закрыть» в dialog/sheet). Все видимые и AT-строки —
  пропсы, которые приложение заполняет из i18n; в библиотеке лишь нейтральные англ. фолбэки.
  `closeLabel` проброшен через `ConfirmDialog`/`SidePanel`. Скан кириллицы в `packages/ui/src` — чисто.

**Решение**: `@cuks/ui` не тянет i18next и не содержит продуктовой копирайтинг-строки — локализация
живёт в приложении (0.8), пакет презентационный. Dev-showcase — временный, помечен на удаление в 0.8.

### 2026-07-13 — Фаза 0: задача 0.6 (орг-структура API)

**Сделано** (`admin.org.manage`, `/api/v1/admin/*`, схема из 0.3 — миграций нет):

- **Org-units** (`OrgUnitsService`): дерево с счётчиком сотрудников по подразделению; создание
  (materialized `path` от родителя), изменение (в т.ч. `head_position_id` с проверкой
  принадлежности), **перемещение** (`/:id/move`) — пересчёт `path` узла и **всех потомков** в
  транзакции (пути считаются в JS), защита от циклов (нельзя в своё поддерево/в себя), soft-delete
  с блокировкой при живых детях/должностях.
- **Positions** (`PositionsService`): список по подразделению, CRUD, `is_head`; soft-delete
  блокируется при наличии носителей; снятие ссылки `head_position_id` при удалении.
- **User-positions** (`UserPositionsService`): назначение пользователя на должность с ровно одной
  основной (`is_primary`), список, смена основной, снятие (с промоушеном другой в основную).
- Контроллер `/admin/{org-units,positions,user-positions}` под `@RequirePermission('admin.org.manage')`.

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные (40 тестов; +org DTO). **Live**:
дерево (КЧС+дети), создание, **перемещение с пересчётом путей потомков** (проверено по БД: узел и
ребёнок пере-укоренены под новым родителем), отклонение цикла (403 `move_into_descendant`), защита
удаления (`has_children`/`has_positions`/`has_holders`), счётчик сотрудников = 1 после назначения.

**Примечание**: soft-delete подразделений/должностей теперь реально возможен — фильтры
soft-deleted в ACL/Scope (харднутые в ревью 0.5) становятся актуальными.

**Ревью (adversarial).** Прогнан ревью орг-структуры; 8 находок исправлены (критичных нет):

- **[count]** `employeeCount` теперь считает **уникальных активных** сотрудников
  (`countDistinct(user_id)` + join `users` где не удалён и `active`) — без двойного счёта и
  «мёртвых душ». Проверено live (2 должности → 1; blocked → 0).
- **[move]** цикл-гард и пересчёт путей — целиком в транзакции с advisory-lock (`pg_advisory_xact_lock`),
  чтобы конкурентные перемещения не создали цикл.
- **[primary]** DB-бэкстоп «ровно одна основная должность»: частичный unique-индекс
  `user_positions(user_id) WHERE is_primary` (миграция 0003). Проверено: второй primary отклонён БД.
  Гонки duplicate/primary в assign → дружелюбный 400 (перехват 23505); промоушен при снятии —
  детерминирован (orderBy).
- **[integrity]** `head_position_id` при update — только живая должность; удаление подразделения
  блокируется при живых scoped-назначениях ролей (`has_role_scopes`); аудит `primary_set`
  унифицирован (entityType=user).

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
в спеках модулей»).

**Ревью (adversarial).** Прогнан ревью RBAC; 8 находок исправлены (критичных нет):

- **[esc]** privilege-bounded delegation: держатель `admin.roles.manage` (не суперадмин) больше не
  может выдать себе роль superadmin (wildcard) — 403 `superadmin_forbidden`; и не может создать/
  назначить роль с правами, которых сам не имеет — 403 `permission_exceeds_grant`/`exceeds_grant`.
  Отзыв superadmin-назначения — только суперадмином. Проверено live.
- **[corr]** `create()` проверяет занятость кода только среди живых ролей (isNull deletedAt) —
  соответствует partial-unique; замена прав роли — в транзакции (нет окна «ноль прав»); `getOne`
  без re-list всей таблицы.
- **[acl]** фильтр soft-deleted позиций/подразделений в resolveUserSubjects/expandSubtrees/assign;
  дедуп результата поддерева; аудит `acl.revoked` с ресурсом/субъектом/уровнем.

**Документированные решения ревью**:
- Списки `/admin/{roles,permissions,role-assignments}` возвращают массивы (ограниченные
  конфиг-списки, не большие таблицы) — без пагинации docs/04.
- Level-3 `org_unit`-субъект ACL сопоставляется с **прямыми** подразделениями пользователя (без
  каскада по поддереву); level-2 scope, наоборот, раскрывает поддерево — разные семантики намеренно.
- [P2] Юнит/интеграционные тесты `AclService`/`ScopeService` требуют тест-БД (testcontainers/compose,
  docs/04) — вводятся с харнессом; сейчас покрыто live-smoke + shared-тестами хелперов.

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
