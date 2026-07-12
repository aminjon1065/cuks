# 05. Аутентификация, роли и права (RBAC)

## 1. Аутентификация

- **Учётные записи создаёт только администратор** (гос-система, самостоятельной регистрации нет). Логин — `username` (латиница) + опциональный email для уведомлений.
- Пароли: argon2id (memory 64МБ, iterations 3, parallelism 4). Политика: ≥ 12 символов, проверка по словарю топ-10k, без обязательной ротации (NIST), смена при первом входе обязательна.
- **Сессии**: Redis, id — 256-битный случайный. Cookie `cuks_session`: httpOnly, Secure, SameSite=Lax, path=/. TTL 12 ч скользящий; чекбокс «Запомнить» — 30 дней. Лимит 10 сессий на пользователя (вытеснение старейшей).
- **CSRF**: для мутаций — заголовок `X-CSRF-Token` (double-submit cookie, выдаётся при логине) + проверка Origin.
- **2FA (TOTP)**: opt-in для всех; **обязателен** для ролей с правами `admin.*`, `docflow.sign` и `gis.pg.access`. Резервные коды (10 шт., одноразовые). Сброс — админом с записью в аудит.
- **Anti-bruteforce**: 5 неудач → блокировка входа на 15 мин (по username и по IP), событие в аудит. Rate-limit `/auth/*` — 10 rpm/IP.
- Восстановление пароля: только через администратора (сброс с выдачей временного пароля) — email-восстановления нет (интернет-почта не гарантирована).
- Сессии видны пользователю (Настройки → Безопасность): устройство, IP, последняя активность, «завершить», «завершить все другие».

### Эндпоинты
`POST /auth/login` (username, password, [totp]) → сессия; `POST /auth/logout`; `POST /auth/logout-all`; `GET /auth/me` (профиль + права + орг-контекст); `POST /auth/password` (смена); `POST /auth/totp/setup|confirm|disable`; `GET/DELETE /auth/sessions`.

### Аудит: `auth.login.success|failure`, `auth.logout`, `auth.password.changed`, `auth.totp.*`, `auth.session.revoked`, `auth.lockout`.

## 2. Орг-структура

```
КЧС (root)
├── Центральный аппарат
│   ├── Управление защиты населения…
│   ├── Управление гражданской обороны
│   └── Канцелярия
├── Управление по Согдийской области
│   └── Отдел по г. …
├── Управление по Хатлонской области
├── Управление по ГБАО
└── Управления/отделы РРП
```

- `org_units` — дерево (parent_id, materialized path `path` для быстрых поддеревьев), тип: `committee|department|division|unit`.
- `positions` — должности внутри подразделения (название, ранг для сортировки, флаг `is_head` — руководитель подразделения).
- Пользователь занимает 1+ должностей (`user_positions`); основная — одна (`is_primary`).
- Орг-контекст пользователя = его подразделение(я); руководитель «видит» своё поддерево.

## 3. Модель прав: три уровня

**Уровень 1 — глобальные разрешения (permissions).** Строки вида `module.action`, собранные в **роли-шаблоны**. Назначаются пользователю глобально или **со скоупом на подразделение** (`user_roles: user_id, role_id, org_unit_id nullable`). Скоуп означает: право действует на объекты этого подразделения и его поддерева.

**Уровень 2 — скоупы данных.** Объекты принадлежат подразделению (`org_unit_id` у документов, ЧС, общих папок). Запросы фильтруются: пользователь видит объекты своих подразделений + явно расшаренные + публичные в рамках модуля. Правила — в спеках модулей.

**Уровень 3 — ACL ресурсов.** Для конкретных объектов (папка, файл, проект задач, канал, слой, запись встречи): таблица `resource_acl (resource_type, resource_id, subject_type user|org_unit|role, subject_id, level viewer|editor|manager)`. Манагер может управлять доступом.

Реализация: CASL. Ability строится на бэке из ролей+скоупов (guard `@RequirePermission('docflow.register')` + проверки ACL в сервисах), сериализуется в `GET /auth/me` → фронт использует ту же ability для скрытия UI.

## 4. Каталог permissions (v1, `packages/shared/permissions.ts`)

| Модуль | Permission | Описание |
|---|---|---|
| admin | `admin.users.manage` | Пользователи: создание, блокировка, сброс пароля/2FA |
| admin | `admin.org.manage` | Орг-структура и должности |
| admin | `admin.roles.manage` | Роли и назначения |
| admin | `admin.dicts.manage` | Справочники (виды ЧС, корреспонденты, журналы…) |
| admin | `admin.settings.manage` | Настройки платформы |
| admin | `admin.audit.view` | Просмотр аудит-журнала |
| files | `files.use` | Личные файлы и доступ по шарингу (базовое право всех) |
| files | `files.org.manage` | Управление общими папками своего подразделения |
| gis | `gis.view` | Просмотр карт и реестра ЧС |
| gis | `incidents.create` | Создание донесений/ЧС |
| gis | `incidents.manage` | Редактирование/закрытие ЧС, подтверждение данных |
| gis | `gis.layers.edit` | Редактирование объектов слоёв |
| gis | `gis.layers.manage` | Создание/настройка/публикация слоёв, стили |
| gis | `gis.import` / `gis.export` | Импорт/экспорт геоданных |
| gis | `gis.pg.access` | Выдача прямого PostGIS-доступа (QGIS) |
| analytics | `analytics.view` | Дашборды и отчёты |
| analytics | `analytics.build` | Конструктор отчётов, сохранённые отчёты |
| docflow | `docflow.use` | Участие в ДОУ: свои документы, согласование, ознакомление |
| docflow | `docflow.create` | Создание проектов документов |
| docflow | `docflow.register` | Регистрация в журналах (канцелярия) |
| docflow | `docflow.journals.manage` | Настройка журналов и нумерации |
| docflow | `docflow.sign` | Подписание ЭЦП |
| docflow | `docflow.resolve` | Наложение резолюций |
| docflow | `docflow.control` | Контроль исполнения (снятие с контроля, продление) |
| docflow | `docflow.reports.view` | Отчёты исполнительской дисциплины |
| docflow | `docflow.confidential.view` | Доступ к документам ДСП (+ обязательное логирование чтения) |
| tasks | `tasks.use` | Задачи: участие, свои проекты |
| tasks | `tasks.projects.create` | Создание проектов |
| chat | `chat.use` | Чат |
| chat | `chat.channels.create` | Создание каналов |
| chat | `chat.admin` | Модерация всех каналов, экспорт переписки |
| meet | `meet.use` | Участие в звонках |
| meet | `meet.record` | Запуск записи |
| meet | `meet.recordings.manage` | Управление всеми записями |

## 5. Роли-шаблоны (сиды; админ может менять/создавать)

| Роль | Права |
|---|---|
| **Суперадмин** | всё (bypass, только 1–2 аккаунта) |
| **Администратор платформы** | `admin.*`, `files.use`, `chat.use`, `meet.use`, `tasks.use` |
| **Руководитель** | всё пользовательское + `docflow.sign`, `docflow.resolve`, `incidents.manage`, `analytics.*`, `meet.record` (скоуп — своё поддерево) |
| **Оперативный дежурный** | `gis.view`, `incidents.create/manage`, `analytics.view`, `chat.*базовое*`, `meet.use/record`, `tasks.use`, `files.use`, `docflow.use` |
| **Делопроизводитель** | `docflow.use/create/register/control/reports.view`, `files.use`, `chat.use`, `tasks.use` |
| **Аналитик ГИС** | `gis.*`, `analytics.*`, `files.use`, `chat.use`, `tasks.use`, `meet.use` |
| **Сотрудник** | `files.use`, `docflow.use/create`, `tasks.use`, `chat.use`, `meet.use`, `gis.view`, `analytics.view` |

## 6. Замещения

`substitutions (principal_id, deputy_id, scope: all|docflow, starts_at, ends_at, active)`. На время замещения заместитель видит и исполняет шаги маршрутов/резолюции замещаемого (интерфейс показывает «за кого» действие; подпись всегда своя, с пометкой «за»). Настраивает сам руководитель или админ. Аудит: `auth.substitution.created/used`.

## 7. UI

- `/login` — минималистичный: логотип КЧС, username/password, TOTP-шаг, капс-лок ворнинг. Без «забыли пароль» (текст: «обратитесь к администратору»).
- Первый вход: форс-смена пароля + предложение включить 2FA (для обязанных — без «пропустить»).
- Настройки → Безопасность: смена пароля, 2FA, сессии.
- Админ-часть — в modules/16-admin.md.

## Критерии приёмки
- Логин/логаут/2FA/lockout работают, сессии отзываются мгновенно.
- Guard на каждом эндпоинте; e2e-тесты 403 на чужой скоуп (документ чужого подразделения недоступен).
- `GET /auth/me` отдаёт ability; UI скрывает недоступные разделы; прямой URL без прав → экран 403.
- Замещение переключает исполнителя маршрутов на период.
