# Модуль 11. Документооборот (ДОУ) + ЭЦП

Полноценный корпоративный документооборот: регистрация, маршруты согласования/подписания/ознакомления, резолюции с контролем исполнения, внутренняя ЭЦП, отчёты исполнительской дисциплины.

## 1. Понятия

- **Журнал** — регистрационная книга с собственной нумерацией: Входящие, Исходящие, Приказы, Распоряжения, Служебные записки, Протоколы, Обращения граждан. Настраиваются админом/канцелярией.
- **Документ (карточка)** — реквизиты + файлы (с версиями) + маршрут + резолюции + связи + история.
- **Маршрут** — последовательность шагов: согласование (параллельное/последовательное), подписание, регистрация, ознакомление, исполнение.
- **Резолюция** — поручение руководителя по документу: текст, ответственный, соисполнители, срок, контроль.
- **Номенклатура дел** — справочник индексов дел для списания документов в дело.

## 2. Права
`docflow.use` (базовое) · `docflow.create` · `docflow.register` · `docflow.journals.manage` · `docflow.sign` · `docflow.resolve` · `docflow.control` · `docflow.reports.view` · `docflow.confidential.view` · `docflow.archive.hold` · `docflow.archive.dispose`. Полный каталог прав — `packages/shared/src/permissions/index.ts`. Legal hold и выделение к уничтожению — **два отдельных права**, а не часть registry-доступа: запрет на уничтожение есть юридическое указание, исполнение акта необратимо, и ни то, ни другое не должно доставаться тому, кому просто выдали реестр.

**Видимость документа** (`apps/api/src/modules/docflow/document-visibility.ts`) — **участие ИЛИ registry-доступ**, и поверх этого отдельным `AND` — гриф:

- **участие** (`documentInvolvementWhere`): автор, допуск-список, соисполнитель (`document_collaborators`), названный подписант проекта резолюции, адресат шага маршрута (с учётом замещений), автор/исполнитель/соисполнитель резолюции, назначенный на ознакомление;
- **registry-доступ** (`hasRegistryAccess`): носитель `docflow.register` **или** `docflow.control` видит **весь не-ДСП реестр целиком** — без разделения по журналам и без ограничения подразделением;
- **гриф** (`confidentialityGuard`): ДСП — только допуск-список ∩ `docflow.confidential.view`. Это отдельное «И», поэтому registry-доступ в ДСП не проходит никогда.

Отдельного правила «руководитель подразделения-владельца видит своё поддерево» в коде **нет** — ни в предикате списка `visibleDocumentsWhere`, ни в гейте карточки. Иерархия оргструктуры участвует в модуле только при эскалации просрочки (§5).

**Роли внешнего ТЗ — через permissions, не через проверки `role === '…'`** (СЭД 2.0 §5.1). Отображение ролей ТЗ на CUKS:

| Роль ТЗ | Представление в CUKS | Ключевые права |
|---|---|---|
| Администратор | `superadmin` / platform admin | `docflow.journals.manage` + админ-права |
| Директор / председатель | руководитель глобального scope | `docflow.sign`, `docflow.resolve`, `docflow.control` |
| Заместитель | руководитель + активное замещение | те же права в разрешённом scope, действия помечаются «за» |
| **Канцелярия (общий отдел)** | clerk | `docflow.register` — регистрация и отправка; настройки ДОУ — `docflow.journals.manage`; сдача в дело / возврат из архива — `docflow.register` **или** `docflow.control`; legal hold — `docflow.archive.hold`; акты о выделении — `docflow.archive.dispose` |
| Начальник управления/отдела | руководитель ветки оргструктуры | `docflow.resolve`, `docflow.control` в своём поддереве |
| Сотрудник | employee | `docflow.use`, `docflow.create` |

Таблица описывает **намерение** отображения ролей ТЗ, а не реализованное сужение: строка «в своём поддереве» — это то, как роль выдают, а не то, что проверяет код. Права в CUKS глобальны, и носитель `docflow.control` видит весь не-ДСП реестр, а не только своё поддерево (см. выше). Сужение до подразделения на уровне видимости документов не реализовано.

Как права разложены по **штатным шаблонам** (`ROLE_TEMPLATES`, `packages/shared/src/permissions/index.ts` — семь шаблонов: `superadmin`, `platform_admin`, `chief`, `duty_officer`, `clerk`, `gis_analyst`, `employee`): `docflow.journals.manage` держат `clerk` («Делопроизводитель» — экран настроек ДОУ канцелярский) и `platform_admin` («Администратор платформы», вместе с `docflow.use`, без которого экран настроек не загрузит собственные списки). `docflow.archive.hold` и `docflow.archive.dispose` лежат на `chief` («Руководитель»); отдельного шаблона «архивариус» в системе **нет**, поэтому канцелярии архивные права достаются только именной выдачей роли или прав.

**Канцелярия** — носитель `docflow.register`. **Подписант проекта резолюции** — названный в проекте `signer_id`, его активный заместитель либо суперадмин; право `docflow.sign` к решению по проекту отношения **не имеет** — оно нужно для ЭЦП (`POST /docflow/documents/:id/actions/sign`), а все маршруты проектов резолюций гейтятся `docflow.use`, и решающего выбирает `resolveProposalDecider`, который прав вообще не читает (`apps/api/src/modules/docflow/resolution-proposals.controller.ts`, `resolution-proposals.policy.ts` — подробно в §12.11). Бизнес-сервисы проверяют право и org-scope, а не название должности.

Трек СЭД 2.0 добавил в каталог **ровно два** права — `docflow.archive.hold` и `docflow.archive.dispose` (`packages/shared/src/permissions/index.ts`). Всё остальное легло на действующие: отправка гейтится `docflow.register` (`dispatches.controller.ts`), шаблоны документов и типы резолюций — `docflow.journals.manage` (`document-templates.controller.ts`, `resolution-proposals.controller.ts`), проекты резолюций и распространение — `docflow.use`. Прав `docflow.document.dispatch` и `docflow.template.manage` в системе не существует.

## 3. Модель данных (`app`)

**journals**: code, name, doc_class `incoming|outgoing|internal|citizens`, number_template (`{П}-{YYYY}/{seq4}`), seq_reset `yearly`, org_unit_id null (журналы подразделений), is_active. **journal_counters**: journal_id, year, last_seq (уникальность, инкремент в транзакции — номера без дыр и дублей).

**Календарь нумерации — Asia/Dushanbe.** `{YYYY}`/`{YY}`/`{MM}` и бакет счётчика (`journal_counters.year`) вычисляются по местной гражданской дате момента регистрации, а не по UTC: регистрационная книга канцелярии переворачивается в местную полночь = 19:00 UTC. Момент `2026-12-31T19:30Z` — это уже 1 января 2027 в Душанбе, и документ попадает в книгу 2027 года. В БД `reg_date` по-прежнему хранится в UTC (`timestamptz`). Общий helper — `businessDateParts()` в `@cuks/shared` (`src/time`); журнал с `seq_reset='never'` остаётся сплошной книгой (бакет 0), но в номере печатается местный год. Уже выданные номера пересчёту не подлежат.

**documents**: journal_id null (до регистрации), reg_number null, reg_date null, doc_class, type_code (справочник видов), subject, summary, org_unit_id (владелец), author_id, status `draft → on_route → pending_registration → registered → in_progress(исполнение) → completed ⇢ archived` (+ `rejected`, `recalled`), confidentiality `normal|dsp`, access_list uuid[] (для ДСП), due_date null, case_index null (номенклатура), correspondent_id null (для входящих/исходящих), outgoing_number/date null (реквизиты письма контрагента), delivery `mail|email|courier|fax`.

Стрелка `completed ⇢ archived` — **не переход графа**: `DOCUMENT_STATUS_TRANSITIONS.completed` пуст, и `archived` не является целью ни одного ручного перехода (`packages/shared/src/enums/index.ts`). Единственный вход в архив — команда сдачи в дело; попытка сменить статус получает `docflow.document.use_archive_command` (§12.12).

**Полнотекстовый вектор** `documents.search_tsv` — генерируемая колонка со **взвешенными** зонами (`packages/db/src/schema/docflow.ts`): **A** — `subject` + `reg_number`, **B** — `summary` + `sender_name` + `recipient_name`, **C** — `content_text`. Имя корреспондента и текст вложений в этот вектор не входят — они матчатся собственными индексами и присоединяются запросом поиска (§12.13).

**`documents.delivery` и `document_dispatches.channel` — разные вещи, и перечисления у них не пересекаются.** `delivery` (`mail|email|courier|fax`) — реквизит карточки, унаследованный от мастера регистрации входящего (`registerIncomingSchema.delivery`): «как письмо к нам попало». Факт нашей отправки фиксируется **только** строкой `document_dispatches` с каналом `courier|postal|email|integration|hand_delivery|other` (§12.3). Ответ на вопрос «как ушло» берётся из dispatches, `delivery` на него не отвечает.

Состав колонок `documents` вырос за трек СЭД 2.0 (`version`, `content_json`/`content_text`, `template_version_id`, `registration_key`, снимки корреспондента, `response_due_at`, архивные и disposition-поля, legal hold) — перечень выше показывает исходное ядро; полный актуальный состав с индексами и ограничениями — `packages/db/src/schema/docflow.ts`, обзор добавленного — §12.4a.

**document_files**: document_id, file_id, kind `main|attachment`, version int (авто), title, is_current. Новая версия main-файла до подписания — свободно; после первой подписи файл заморожен (новая версия = снятие подписей с предупреждением).

**routes**: document_id, status `active|completed|cancelled`, created_by. **route_steps**: route_id, order int, kind `approve|sign|register|acknowledge|execute`, mode `sequential|parallel` (группа шагов одного order — параллельна), assignee_type `user|position|org_unit`, assignee_id, due_hours null, status `pending|active|done|rejected|skipped`, decision `approved|rejected|signed|acknowledged` null, comment, acted_by (фактический исполнитель — учёт замещений), acted_at.
Логика: шаги активируются по order; отклонение (reject) с комментарием → маршрут останавливается, документ автору в `draft` (доработка) → повторный запуск = новый цикл маршрута (история циклов хранится). Шаблоны маршрутов: **route_templates** (name, org_unit_id, steps jsonb) — «Приказ: юрист → зам → председатель».

**resolutions**: document_id, author_id, text, executor_id (ответственный), co_executors uuid[], due_date, is_control bool, status `active|done|cancelled`, parent_id null (подрезолюции), report text null (отчёт об исполнении), done_at, накопительный контроль: **resolution_extensions** (старый срок, новый срок, причина, кто продлил).

**certificates**, **signatures** — см. docs/09-security.md §4.

**acquaintances** (лист ознакомления для приказов): document_id, user_id, acknowledged_at null — генерируется шагом acknowledge на подразделение (разворачивается в список сотрудников).

## 4. Жизненные циклы

**Входящий**: канцелярия: «Зарегистрировать входящий» (мастер: скан/файл, корреспондент, их номер/дата, тема, кому — руководитель) → номер авто → руководителю «на резолюцию» → резолюция (исполнитель+срок+контроль) → исполнителю в inbox → исполнение (отчёт, при необходимости — создание исходящего-ответа со связью) → «исполнено» → в дело.

**Исходящий/внутренний**: автор создаёт проект (файл DOCX/PDF, реквизиты) → маршрут из шаблона или ручной → согласование (визы, параллельно/последовательно) → подписание ЭЦП → регистрация канцелярией (номер) → отправка (отметка способа) / рассылка внутренняя → в дело.

**Приказ**: + шаг «ознакомление» — сотрудники получают в inbox «Ознакомиться», жмут «Ознакомлен» (фиксация как лёгкая подпись context=acknowledge); лист ознакомления виден в карточке.

## 5. Контроль исполнения

- Всё с `is_control=true` (резолюции) и `due_date` (документы) попадает в представление «На контроле» (`docflow.control`): таблица с цветовой шкалой сроков (>3 дней — норм, ≤3 — warning, просрочено — danger).
- Напоминания — очередь BullMQ **`deadlines`** (`QUEUE.deadlines` в `packages/shared/src/queues/index.ts`), repeatable-задание `0 8 * * *` с `tz: 'Asia/Dushanbe'` (`apps/worker/src/queues/deadlines/deadlines.module.ts`). Одна развёртка закрывает три предмета: контрольные резолюции, сроки задач и SLA шагов маршрута (§12.9). Очереди `docflow-deadlines` не существует.
- Адресаты (`deadlines.processor.ts`): напоминание за 3 / 1 / 0 дней до срока — **исполнителю**; просрочка, ежедневно — **исполнителю и автору резолюции**. Поля «контролёр» у `app.resolutions` нет (есть только `is_control`), и третьего адресата в развёртке нет.
- Эскалация просрочки >5 дней — руководителям подразделения исполнителя. Для **ДСП**-документа этот список дополнительно фильтруется: остаются только автор документа и те, кто в допуск-списке. Иначе эскалация вынесла бы тему закрытого документа наружу через принудительное (critical) уведомление.
- Снятие с контроля/продление срока — только `docflow.control` или автор резолюции, с причиной (аудит).
- **Отчёт исполнительской дисциплины**: за период по подразделениям/исполнителям: всего поручений, исполнено в срок, с просрочкой, не исполнено; % дисциплины; XLSX.

## 6. ЭЦП в UI

- Кнопка «Подписать» на шаге sign: модал — что подписывается (файл+хэш, реквизиты), подтверждение паролем/TOTP → WebCrypto-подпись → шаг done. Первая подпись пользователя — мастер активации (генерация ключа устройства, выпуск сертификата, 30 сек).
- В карточке — блок «Подписи» (`GET /docflow/documents/:id/signatures`): кто/когда/валидность, ссылка на страницу проверки **`/app/verify/:signatureId`** (SPA-маршрут внутри оболочки `/app` — `apps/web/src/app/router.tsx`). API проверки — `GET /verify/:signatureId` под `@RequirePermission('docflow.use')` (`apps/api/src/modules/docflow/signatures.controller.ts`): **анонимной страницы проверки сегодня нет**, для проверки нужна активная сессия. Публичная проверка по QR потребовала бы отдельного неаутентифицированного эндпоинта и здесь не реализована.
- Экспорт «PDF с отметкой об ЭЦП» — штамп-страница + QR (09-security §4).

## 7. UI-экраны

- **`/app/docs` — Мой кабинет ДОУ**: вкладки-очереди в порядке экрана (`apps/web/src/features/docflow/pages/DocumentsPage.tsx`): «Мои документы», «На согласование (N)», «На подпись (N)», «На ознакомление (N)», «Мои поручения (N)», «Черновики» и — только носителю `docflow.register` **или** `docflow.control` — «Реестр» (весь не-ДСП реестр целиком, §12.13). Счётчик показан на четырёх очередях действий, у «Моих документов», «Черновиков» и «Реестра» его нет. Значение `authored` в `DOCUMENT_QUEUES` есть, но вкладки для него экран не строит. Колонки строки: регномер, тема, класс, статус, автор, дата (регистрации либо создания) и — по правам — ячейка прямых действий (Согласовать/Отклонить с комментарием, не заходя в карточку). Отдельной колонки срока в списке нет; срок виден в карточке и в «Требует внимания».
- **Карточка документа**: PageHeader (регномер+тема+StatusBadge+гриф ДСП бейдж; действия: Отправить по маршруту / Подписать / Зарегистрировать / Резолюция / Экспорт PDF / ⋯). Вкладки: Обзор (реквизиты+файлы с inline-PDF-просмотром), Маршрут (визуальный степпер шагов: аватары, статусы, комментарии, время), Резолюции (дерево поручений со статусами), Связи, История (полный лог). Правая колонка-сводка: срок, дело, корреспондент, подписи.
- **Журналы** — `/app/docs/journals` (`JournalsRegisterPage`, пункт меню под `docflow.register`): выбор журнала → DataTable записей за год, фильтры, печать реестра, карточка регистрации (мастер для входящих — 60 секунд: файл → корреспондент (поиск+создание на лету) → тема → адресат).
- **Поиск** — `/app/docs/search` (`SearchPage`): полнотекстовый поиск по реестру, сохранённые представления (§12.13). Собственного пункта меню нет — вход из реестра и из панели «Требует внимания».
- **Архив** — `/app/docs/archive` (`ArchivePage`, меню под `docflow.register`): опись, акты о выделении, legal hold (§12.12).
- **Очередь разбора обмена** — `/app/docs/exchange` (`ExchangeInboxPage`, меню под `docflow.register`): входящие сообщения транспорта до превращения в документ (§12.14).
- **Контроль** — `/app/docs/control` (меню под `docflow.control`), **Отчёты** — `/app/docs/reports` (меню под `docflow.reports.view`).
- **Замещения** — `/app/docs/substitutions` (меню под `docflow.use`, §12.8).
- **Проверка подписи** — `/app/verify/:signatureId`.
- **Настройки ДОУ** — `/app/docs/settings` (меню под `docflow.journals.manage`). Шесть вкладок: журналы, корреспонденты, номенклатура, типы резолюций, шаблоны документов, шаблоны маршрутов (`apps/web/src/features/docflow/pages/DocflowSettingsPage.tsx`). Вкладки «виды документов» здесь **нет**: виды приходят из общей таблицы `app.dictionaries` (тип `doc_type`) и доступны только на чтение — `GET /docflow/document-types`. Экрана и CRUD-API для их правки в системе нет вовсе: справочник наполняется сидом (`packages/db/src/seed.ts`) или SQL. Право `admin.dicts.manage` в каталоге объявлено, но ни один контроллер его сегодня не требует.

Маршруты — `apps/web/src/app/router.tsx`, права пунктов меню — `apps/web/src/app/shell/nav-items.ts`.

## 8. API

Перечень собран из контроллеров `apps/api/src/modules/docflow/*.controller.ts`; право в таблице — это то, что стоит на декораторе `@RequirePermission`, поэтому его можно проверить построчно. Право маршрута — **гейт входа, а не достаточное условие**: почти каждый обработчик дополнительно проверяет видимость документа, гриф и состояние (см. §12), а у архива фактическое разграничение целиком лежит в сервисе.

**Реестр и карточка** (`documents.controller.ts`)

| Метод и путь | Право |
|---|---|
| `GET /docflow/documents` | `docflow.use` |
| `GET /docflow/documents/queue-counts` | `docflow.use` |
| `POST /docflow/documents` | `docflow.create` |
| `POST /docflow/documents/register-incoming` (атомарно, `idempotencyKey` — §12.2) | `docflow.register` |
| `GET /docflow/documents/:id` | `docflow.use` |
| `PATCH /docflow/documents/:id` (`expectedVersion` — §12.5) | `docflow.create` |
| `GET /docflow/documents/:id/history` · `/timeline` | `docflow.use` |
| `GET /docflow/documents/:id/read-log` | `docflow.use` |
| `GET` · `PATCH /docflow/documents/:id/access` | `docflow.use` |
| `GET` · `POST /docflow/documents/:id/collaborators`, `DELETE …/collaborators/:collaboratorId` | `docflow.use` |
| `POST /docflow/documents/:id/files` (+ версии) | `docflow.create` |
| `GET /docflow/documents/:id/files/:fileId/download` · `/preview` (видимость + ДСП + AV — §12.2) | `docflow.use` |
| `POST /docflow/documents/:id/actions/register` | `docflow.register` |
| `POST /docflow/documents/:id/actions/create-response` (§12.3) | `docflow.create` |
| `POST /docflow/documents/:id/actions/status` | `docflow.use` |
| `GET` · `POST /docflow/documents/:id/links`, `DELETE …/links/:linkId` (`document-links.controller.ts`) | `docflow.use` |

Параметры списка (`listDocumentsQuerySchema`, `packages/shared/src/dto/docflow.ts`): `queue` — `mine｜drafts｜authored｜registry｜to_approve｜to_sign｜to_acknowledge｜my_tasks` (значения `to_ack` не существует), а также `page`, `limit`, `status`, `docClass`, `journalId`, `search`, `year`, `sort` (allow-list `DOCUMENT_SORT_FIELDS`), `overdue`, `awaitingDispatch`.

**Маршруты и ознакомление по шагу** (`routes.controller.ts`, `acknowledgements.controller.ts`)

| Метод и путь | Право |
|---|---|
| `POST /docflow/documents/:id/route` (из шаблона / ручной) | `docflow.create` |
| `POST /docflow/documents/:id/route/validate` (dry-run — §12.9) | `docflow.create` |
| `GET /docflow/documents/:id/routes` | `docflow.use` |
| `POST /docflow/route-steps/:id/actions/approve` · `complete` · `reject` · `acknowledge` | `docflow.use` |
| `GET /docflow/documents/:id/acquaintances` | `docflow.use` |
| `GET /docflow/route-templates` | `docflow.use` |
| `POST` · `PATCH` · `DELETE /docflow/route-templates[/:id]`, `POST …/:id/actions/clone` | `docflow.journals.manage` |

**Резолюции** (`resolutions.controller.ts`). `PATCH /docflow/resolutions/:id` **не существует** — жизненный цикл резолюции выражен командами:

| Метод и путь | Право |
|---|---|
| `GET /docflow/documents/:id/resolutions` | `docflow.use` |
| `POST /docflow/documents/:id/resolutions` | `docflow.resolve` |
| `POST /docflow/resolutions/:id/subresolutions` | `docflow.use` |
| `POST /docflow/resolutions/:id/actions/report` · `done` · `extend` · `cancel` · `uncontrol` | `docflow.use` |

**Проекты резолюций, типы, предварительное ознакомление** (`resolution-proposals.controller.ts`, §12.11)

| Метод и путь | Право |
|---|---|
| `GET /docflow/resolution-types` | `docflow.use` |
| `POST` · `PATCH` · `DELETE /docflow/resolution-types[/:id]` | `docflow.journals.manage` |
| `GET` · `POST /docflow/documents/:id/resolution-proposals` | `docflow.use` |
| `PATCH /docflow/resolution-proposals/:id` | `docflow.use` |
| `POST /docflow/resolution-proposals/:id/actions/submit` · `approve` · `reject` | `docflow.use` |
| `POST /docflow/acquaintance-batches/:id/actions/acknowledge` | `docflow.use` |

**Распространение и отправка** (`distributions.controller.ts`, `dispatches.controller.ts`)

| Метод и путь | Право |
|---|---|
| `GET` · `POST /docflow/documents/:id/distributions` (§12.4) | `docflow.use` |
| `GET /docflow/documents/:id/dispatches` | `docflow.use` |
| `POST /docflow/documents/:id/dispatches` | `docflow.register` |
| `POST /docflow/dispatches/:id/actions/confirm` · `fail` · `cancel` · `retry` | `docflow.register` |

**Архив, legal hold и акты о выделении** (`archive.controller.ts`, §12.12). На декораторе у всех маршрутов стоит `docflow.use`; реальное разграничение делает сервис — `hasRegistryAccess` (`docflow.register` **или** `docflow.control`) для описи, сдачи в дело и возврата, `docflow.archive.hold` для hold (`docflow.archive.hold_forbidden`) и `docflow.archive.dispose` для актов (`docflow.archive.dispose_forbidden`), см. `archive.service.ts`.

| Метод и путь | Фактическое право (сервис) |
|---|---|
| `GET /docflow/archive` · `GET /docflow/archive/export` | registry-доступ |
| `POST /docflow/documents/:id/actions/archive` · `restore` | registry-доступ |
| `POST /docflow/documents/:id/actions/legal-hold`, `DELETE /docflow/documents/:id/legal-hold` | `docflow.archive.hold` |
| `GET` · `POST /docflow/archive/disposition-batches` | `docflow.archive.dispose` |
| `POST /docflow/archive/disposition-batches/:id/items` | `docflow.archive.dispose` |
| `POST /docflow/archive/disposition-batches/:id/actions/submit` · `approve` · `reject` · `execute` | `docflow.archive.dispose` |

**Поиск, представления, контроль** (`document-search.controller.ts`, `document-views.controller.ts`, `control.controller.ts`)

| Метод и путь | Право |
|---|---|
| `GET /docflow/search` · `/search/quick` · `/attention` (§12.13) | `docflow.use` |
| `GET` · `POST /docflow/views`, `PATCH` · `DELETE /docflow/views/:id` | `docflow.use` |
| `GET /docflow/control` | `docflow.control` |
| `GET` · `POST /docflow/substitutions`, `DELETE /docflow/substitutions/:id` (§12.8) | `docflow.use` |

**Отчёты** (`reports.controller.ts`) — все под `docflow.reports.view`: `GET /docflow/reports/discipline[/export]`, `GET /docflow/reports/acknowledgement[/export]`, `GET /docflow/reports/register[/export]?kind=movement｜registration｜deadlines｜dispatch｜archive&from&to`.

**Обмен** (`exchange/inbound-review.controller.ts`, §12.14) — все под `docflow.register`: `GET /docflow/exchange/inbound`, `POST /docflow/exchange/inbound/:id/actions/register` · `reject`.

**Шаблоны документов** (`document-templates.controller.ts`, §12.7)

| Метод и путь | Право |
|---|---|
| `GET /docflow/document-templates` · `GET …/:id` | `docflow.use` |
| `POST /docflow/document-templates`, `PATCH …/:id`, `POST …/:id/versions`, `POST …/:id/versions/:version/actions/publish`, `POST …/:id/actions/deactivate` | `docflow.journals.manage` |
| `POST /docflow/document-templates/:id/actions/instantiate` | `docflow.create` |

**Справочники ДОУ** (`docflow.controller.ts`)

| Метод и путь | Право |
|---|---|
| `GET /docflow/journals` · `/nomenclature` · `/correspondents` · `/document-types` · `/correspondent-categories` | `docflow.use` |
| `POST /docflow/correspondents` | `docflow.use` |
| `POST` · `PATCH` · `DELETE /docflow/journals[/:id]` · `/nomenclature[/:id]`, `PATCH` · `DELETE /docflow/correspondents/:id` | `docflow.journals.manage` |

Виды документов доступны только на чтение (`GET /docflow/document-types`) — справочник `doc_type` в `app.dictionaries` правится сидом или SQL, эндпоинта записи для него нет (§7).

**Подписи и экспорт** (`signatures.controller.ts`)

| Метод и путь | Право |
|---|---|
| `POST /signatures/activate` (выпуск сертификата) · `GET /signatures/certificates` | `docflow.sign` |
| `GET /docflow/documents/:id/sign-payload` · `POST /docflow/documents/:id/actions/sign` | `docflow.sign` |
| `GET /docflow/documents/:id/signatures` | `docflow.use` |
| `GET /verify/:signatureId` (сессия обязательна — §6) | `docflow.use` |
| `POST /docflow/documents/:id/export-pdf` (штампованный) | `docflow.use` |

## 9. События, уведомления, аудит

**Realtime.** Модуль публикует **четыре** WS-события (контракт — `packages/shared/src/ws-events/index.ts`); событий `document.signed` и `route.completed` в контракте нет:

| Событие | Когда | Комнаты |
|---|---|---|
| `docflow.route.updated` (`action: started｜step_completed｜rejected`) | старт маршрута, закрытие шага, отклонение | `entity:document:{id}` |
| `docflow.resolution.updated` (`action: proposed｜approved｜rejected｜acknowledged｜released`) | движение проекта резолюции и снятие gate | `entity:document:{id}`; на `released` дополнительно `user:{id}` каждого исполнителя |
| `docflow.dispatch.updated` (`action: created｜sent｜failed｜cancelled`) | открытие и решение попытки отправки | `entity:document:{id}` |
| `docflow.distribution.updated` (`action: created｜acknowledged｜released`) | распространение и подтверждения листа | `entity:document:{id}` |

Payload у всех четырёх — **только идентификаторы и действие**: ни темы, ни номера, ни имени адресата. Документ может быть ДСП, а сокет не должен становиться каналом раскрытия мимо политики. Клиент, получив событие, перечитывает карточку обычным API-запросом и проходит тот же гейт видимости. Подписка `document.subscribe` проверяется гейтвеем по той же базовой видимости, что и REST-карточка (§12.9).

Уведомления (notify): назначение шага, резолюция, возврат на доработку, регистрация, напоминания сроков (`docflow.deadline`, `docflow.route_deadline` — §5, §12.9), назначение на ознакомление (`docflow.acquaintance.assigned`).

**Аудит модуля.** Событий заметно больше, чем перечислено в docs/09 §5, и часть имён там разошлась с кодом: `step_completed` в коде нет (пишутся `docflow.document.route_step_done` и `docflow.document.route_rejected`, `routes.service.ts`), события `docflow.document.completed` тоже нет. **Список в docs/09 §5 требует такой же правки** — здесь приведён фактический перечень (литералы `action:` в `apps/api/src/modules/docflow/**`):

| Группа | Действия |
|---|---|
| Карточка | `docflow.document.created` · `updated` (meta `changedFields` — только **имена** полей) · `registered` (meta `atomic` для §12.2) · `status_changed` · `access_changed` · `collaborator_added` · `collaborator_removed` · `file_added` · `file_downloaded` (`fileId`/`versionId`/`mode`) · `exported` · `linked` · `unlinked` · `response_created` · `signed` · `acknowledged` |
| Маршруты | `docflow.document.route_started` · `route_step_done` · `route_rejected` |
| Резолюции | `docflow.document.resolution_added` · `resolution_reported` · `resolution_done` · `resolution_extended` · `resolution_cancelled` · `resolution_uncontrolled` |
| Проекты и gate | `docflow.resolution_proposal.created` · `submitted` · `approved` · `rejected`; `docflow.acquaintance.released` |
| Распространение и отправка | `docflow.distribution.created`; `docflow.dispatch.created` · `sent` · `failed` · `cancelled` |
| Архив и выбытие | `docflow.archive.archived` · `restored` · `legal_hold_set` · `legal_hold_cleared`; `docflow.disposition.created` · `submitted` · `approved` · `rejected` · `executed` |
| Обмен | `docflow.exchange.received` · `registered` · `rejected` · `sent` · `retry_scheduled` · `dead_lettered` (два последних пишет `exchange-sender.service.ts` без актора: `actorId: null`) |
| Замещения | `auth.substitution.created` · `auth.substitution.revoked` (`substitutions.service.ts`); `auth.substitution.used` — отдельной записью рядом с решением шага и подписью, когда действие сделано «за» принципала (`routes.service.ts`, `signatures.service.ts`, §12.8) |
| Справочники и шаблоны | `docflow.journal.*` · `docflow.nomenclature.*` · `docflow.correspondent.*` · `docflow.resolution_type.*` (`created`/`updated`/`deleted`); `docflow.document_template.created` · `updated` · `version_added` · `version_published` · `deactivated`; `docflow.route_template.created` · `updated` · `cloned` · `deleted` |
| Подписи | `signature.created` · `signature.cert_issued` |

Два ограничителя определяют, что из аудита вообще попадает на экран: **allow-list ключей метаданных** ленты карточки (§12.5) — новое место аудита не может вывести содержимое документа, ключ файла или чужой контакт одним фактом своего появления, — и **read_log** для ДСП, куда дополнительно пишется каждое чтение закрытого документа и его файлов.

## 10. Критерии приёмки
- Полный цикл входящего и исходящего проходят e2e-тестом (регистрация→резолюция→исполнение; проект→согласование→подпись→регистрация).
- Нумерация: конкурентная регистрация 50 документов параллельно — без дублей/дыр (тест); период номера — душанбинский, включая границу года (unit).
- Подпись проверяется на `/verify`, подмена файла ломает валидность (тест).
- Отклонение возвращает автору с комментарием; новый цикл маршрута сохраняет историю первого.
- Просрочка генерирует напоминания по расписанию (тест с фейк-таймером).
- Замещение: заместитель видит и исполняет шаг за отсутствующего, подпись помечена «за».
- ДСП-документ невидим **любому** носителю `docflow.register`/`docflow.control`, не входящему в допуск-список: гриф — отдельное «И» поверх участия и registry-доступа (`confidentialityGuard`), а не оговорка про журнал — разделения видимости по журналам в модели нет вовсе. Чтение логируется в read_log. Покрыто `apps/web/e2e/docflow-dsp.spec.ts`.

## 11. V2+
Гос-ЭЦП, OCR сканов. Остальное из прежнего списка V2+ (шаблоны документов, межведомственный обмен, архивное хранение по срокам номенклатуры) переведено в трек СЭД 2.0 — см. §12.

## 12. СЭД 2.0 — целевая модель

Развитие принятого модуля по внешнему ТЗ заказчика. Исполнимый план (схема, API, UI, тесты, миграции, приёмка) — `docs/plan/sed_plan_implementation.md`; сводка прогресса — трек «СЭД 2.0» в `docs/plan/ROADMAP.md`. Расширяются существующие таблицы и сервисы `docflow`; параллельный модуль `sed` не создаётся.

### 12.1. Жизненный цикл и отправка

Основной автомат состояний §3 сохраняется. Единого класса-политики переходов **нет** (класса `DocumentWorkflowPolicy` в коде не существует) — правило разложено на три места, и это разложение намеренное:

- **граф** — `DOCUMENT_STATUS_TRANSITIONS` и `documentTransitionAllowed` в `@cuks/shared` (`packages/shared/src/enums/index.ts`): один список допустимых ручных переходов, общий для сервера и карточки;
- **политика действия** — чистый модуль `apps/api/src/modules/docflow/document-actions.ts` (`canEditDocument`, `documentAvailableActions`): что именно доступно **этому** вызывающему, без обращения к БД, поэтому вся матрица покрыта unit-тестами;
- **инварианты перехода** — внутри сервисов, под row lock: проверка права и видимости, доказательство завершённости обязательных шагов/подписи/регистрации, audit **в той же транзакции**, публикация события **только после commit**.

Инвариант остаётся прежним: контроллеры не меняют статус напрямую.

**Отправка — не статус документа.** `sent` не добавляется в `documents.status`; факт и канал отправки живут в отдельной сущности `document_dispatches` со своим автоматом **`pending → sent | failed | cancelled`** — все три исхода **терминальны для строки** (`planDispatchDecision`, `dispatch-policy.ts`). Возврата `failed → pending` нет: повтор (`retry`) **вставляет новую строку** в `pending` с колонками `attempt_no` и `retry_of`, а израсходованная попытка остаётся как была. Каждая попытка — отдельная строка; успешная попытка не затирает историю неудачной.

### 12.2. Входящий процесс

Канцелярия вводит реквизиты и файл → **атомарная регистрация** одной командой → **проект резолюции** (`resolution_proposals`) → подписант утверждает или возвращает → при наличии предварительного ознакомления резолюция открывается исполнителям **только после снятия gate**: все ознакомились (`all_acknowledged`) либо истёк таймаут (`timeout`). Окно берётся из переменной окружения **`DOCFLOW_ACQUAINTANCE_GATE_HOURS`** (default 4 ч — `ACQUAINTANCE_GATE_HOURS` в `@cuks/shared`, объявление — `apps/api/src/config/env.ts`); **runtime-хранилища системных настроек в проекте нет**, поэтому админ-экрана для этого значения тоже нет — правится развёртыванием. Подробности снятия gate — §12.11. Истечение таймаута не считается ознакомлением: оставшиеся получают `expired`, исполнители — доступ. Ответственный исполнитель один, соисполнителей несколько; все решения видны в единой timeline.

**`POST /docflow/documents/register-incoming`** (право `docflow.register`) — реализовано. Одна транзакция создаёт карточку, инкрементирует счётчик журнала, проставляет `reg_number`/`reg_date`/`status='registered'`, связывает файлы и пишет audit-запись: сбой на любом шаге не оставляет черновик и **не расходует номер** (инкремент счётчика откатывается вместе с остальным). Журнал обязан существовать, быть активным и иметь `doc_class='incoming'` (`docflow.journal.not_found` / `docflow.journal.inactive` / `docflow.journal.class_mismatch`); у документа не более одного файла `main`.

**Файлы документа — защищённое чтение.** Прикрепление файла (и атомарная регистрация, и `POST /documents/:id/files`) **переносит узел на сервере** из личного пространства загрузившего в системное дерево `system/docflow/<documentId>/`, обнуляя владельца. Последствия намеренные: автор больше не может удалить, переместить или перешарить тело зарегистрированного документа из файлового менеджера, узел перестаёт занимать его квоту, а файловый ACL отказывает всем (кроме суперадмина) — **единственный путь к телу документа проходит через политику документа**. Перенос идемпотентен: узел, уже находящийся в дереве, не трогается.

Чтение — `GET /docflow/documents/:id/files/:fileId/download` и `.../preview` (право `docflow.use`). Каждый запрос заново выводит ответ из документа: видимость и ДСП (невидимый документ → 404, как и сам документ — без утечки существования) → связь файла именно с **этим** документом (иначе чужой `fileId` читался бы в паре с доступным документом) → антивирусный вердикт → и только затем короткоживущий presigned URL. Постоянная ссылка на объект не выдаётся никогда.

Антивирус: через документ отдаётся **только `clean`**. `infected` и `pending` одинаково отклоняются кодом `docflow.file.not_safe` с `details.avStatus` (UI различает «Заражён» и «Идёт проверка»). Это строже общего файлового менеджера намеренно: тело документа расходится по всем участникам маршрута, знакомящимся и канцелярии, тогда как в файловом менеджере файл читает его же загрузивший. Каждая выдача пишется в audit (`docflow.document.file_downloaded` с `fileId`/`versionId`/`mode`), для ДСП дополнительно в read_log.

Команда **идемпотентна** по `idempotencyKey` (uuid, генерируется клиентом один раз на попытку регистрации и переиспользуется при повторе): повтор возвращает исходный документ и тот же номер. Ключ хранится в `documents.registration_key` под частичным уникальным индексом — он же разрешает гонку двух одновременных повторов: проигравший читает результат победителя, а не выпускает второй номер. Чужой ключ никогда не переиспользуется (`docflow.document.idempotency_conflict`). Audit пишется **внутри той же транзакции** (`AuditService.logWithin`) — одной записью `docflow.document.registered` с `meta.atomic=true`, чтобы вкладка «История» не получала две записи с одинаковой отметкой времени.

### 12.3. Исходящий процесс

Ответ создаётся из карточки входящего одной командой (`POST /docflow/documents/:id/actions/create-response`, право `docflow.create`): черновик исходящего + безопасный snapshot корреспондента + типизированная связь + назначение подготовителя. Доступ ДСП **не расширяется** шире исходного документа. Далее — согласование → подпись → регистрация канцелярией → фиксация канала и квитанции отправки. До регистрации отправка запрещена.

**Что наследует ответ.** Роли контрагента меняются местами: кто написал нам (`sender_name`/`sender_contact` входящего), тот адресат ответа (`recipient_name`/`recipient_contact`). Копируются корреспондент, подразделение-владелец, срок ответа контрагенту и — дословно — гриф с допуск-списком: ответ цитирует письмо, поэтому менее закрытый ответ раскрывает письмо. Ослабить гриф командой нельзя (поля недоступны в DTO); сузить — отдельным `setAccess`. Не копируются номер, журнал, дата регистрации, файлы и контент входящего: это текст корреспондента, а не наш. Источник обязан быть **зарегистрированным** входящим (`docflow.response.source_not_incoming` / `docflow.response.source_not_registered`).

**Связь — существующий вид `reply`** («src отвечает dst»), одна строка на пару, видна с обеих карточек. Отдельный `response_to` не заводился: семантика совпадает, а второй почти такой же вид расходился бы с первым.

**Пресет маршрута**: руководитель подразделения → дополнительные согласующие одной параллельной группой → подпись. Руководитель адресуется **должностью**, а не подразделением: `org_unit`-шаг разворачивается во всех сотрудников и вакантный пост прошёл бы dry-run незамеченным. Шаг `register` в пресет не входит — завершение маршрута само переводит ненумерованный документ в `pending_registration` (§12.6), а канцелярское подразделение в модели ничем не помечено.

**Регистрация исходящего** дополнительно проверяет: журнал того же класса и не закрыт (`docflow.journal.class_mismatch` / `docflow.journal.inactive` — раньше проверялось только для входящих), и наличие подписи, если её требует вид документа (`docflow.document.signature_required`). Требование объявляется флагом `requiresSignature` в `dictionaries.meta` записи `doc_type` — `type_code` и так разрешается по этому справочнику, и вторая таблица видов разошлась бы с первой. Подпись должна покрывать **текущую** основную версию файла: подпись под замещённым телом ничего не доказывает о том, что регистрируют. Проверка применяется к документам, которые выпускает CUKS, — **исходящим и внутренним** (приказ подписывают до присвоения номера). Входящие письма и обращения граждан исключены: они подписаны корреспондентом на бумаге, и требование нашей подписи заблокировало бы канцелярии регистрацию почты (`assertSignatureBeforeRegistration`, `apps/api/src/modules/docflow/documents.service.ts`; то же правило со стороны внутреннего процесса — §12.4).

**Отправка — `document_dispatches`, не статус документа.** Каждая попытка — своя строка (`pending → sent｜failed｜cancelled`, все три терминальны), поэтому «ушло 12-го» и «первая попытка вернулась 10-го» остаются истинными одновременно. Повтор (`retry`) открывает **новую** строку в `pending` рядом с израсходованной, а не оживляет её. Коды отказа (`dispatch-policy.ts`): решённую попытку повторно решить нельзя — `docflow.dispatch.not_pending`; повторить можно **только** `failed` или `cancelled` — на `pending` и `sent` возвращается `docflow.dispatch.not_retryable` (повторная отправка того же письма по мис-клику — не то, что должен уметь интерфейс). Отправка возможна только для зарегистрированного исходящего (`docflow.dispatch.not_registered` / `docflow.dispatch.not_outgoing`), и не из архива (`docflow.dispatch.document_archived`); внутренние документы распространяются ознакомлением. Ручные каналы (курьер, почта, лично, иное) работают полностью; `email`/`integration` отказываются заранее (`docflow.dispatch.channel_unavailable`), пока не зарегистрирован локальный адаптер — принять отправку, которой не будет, хуже, чем отказать. Квитанция при подтверждении **переносится в системное пространство документа и прикрепляется как вложение**, то есть читается тем же антивирусным и правовым гейтом, что и тело, — второго пути к байтам не заводится. Успешная отправка закрывает документ (`completed`), если у него не осталось открытых обязательств и других попыток.

### 12.4. Внутренний процесс

Те же файлы, маршруты, подпись, ознакомление, резолюции и архив; без внешнего корреспондента и без dispatch. Распространение — на пользователей, должности и подразделения через batch ознакомления; шаблон маршрута выбирается по виду документа (приказ, протокол, служебная записка).

**Распространение — batch ознакомления, а не новая сущность.** `POST /docflow/documents/:id/distributions` создаёт строку `acquaintance_batches` вида `distribution` со строками в `acquaintances`, поэтому очередь «На ознакомление», карточка, проверка обязательств и существующий эндпоинт подтверждения (`POST /docflow/acquaintance-batches/:id/actions/acknowledge`) видят её, ничего о ней не зная. Развёртка раз в минуту снимает лист по истечении срока — и не ответившие получают `expired`, а не `acknowledged`.

**Адресаты разворачиваются один раз.** Цели (`user` / `position` / `org_unit`) резолвятся в конкретных активных людей в момент распространения. Принятый завтра сотрудник **не добавляется** во вчерашний лист: приказ адресован тем, кто был на месте, когда его издали, а дозаполнение задним числом сделало бы каждый прошлый лист незаметно неполным. Поддерево подразделения обходится **только по явному запросу**: «отделу» и «управлению со всеми отделами» — разные поручения. Один человек — одна строка, сколько бы целей до него ни дотянулось; это же гарантирует частичный уникальный индекс `(batch_id, user_id)` (существующий `(route_step_id, user_id)` для batch-строк не дедуплицирует: `route_step_id` там NULL, а NULL-ы в Postgres различны). Лист, не достающий никого, отклоняется (`docflow.distribution.no_readers`) — «распространён» с пустым листом неотличим от «никто ещё не прочёл».

Распространяется только **зарегистрированный внутренний** документ (`docflow.distribution.not_internal` / `docflow.distribution.not_registered`): по неномерованному черновику люди расписывались бы за текст, который автор ещё может переписать. Право — автора или канцелярии.

**Статус ознакомления пишется одинаково всеми путями.** Маршрутный путь раньше проставлял только `acknowledged_at`, а gate — `status`, и один и тот же факт читался по-разному в зависимости от запроса; с этапа 7 оба пишут `status` (миграция 0053 выравнивает прежние строки).

**Отчёт по ознакомлению** (`GET /docflow/reports/acknowledgement` + `/export`) в отличие от отчёта дисциплины **называет документы и людей**. Право `docflow.reports.view` стоит на обоих маршрутах (`reports.controller.ts`) и открывает эндпоинт — но **не даёт содержимого**: каждая строка дополнительно проверяется видимостью документа для вызывающего, и недоступная строка **выбрасывается, а не редактируется** — редактированная строка всё равно раскрыла бы, что ДСП-приказ существует и сколько человек в его листе, то есть сам допуск-список. Число выброшенных строк сообщается: неполный лист обязан признавать, что он неполный. `expired` считается отдельно от `acknowledged`.

**Требование подписи при регистрации** распространяется и на внутренние документы: приказ подписывают до присвоения номера. Какие виды этого требуют — конфигурация (`requiresSignature` в `dictionaries.meta` записи `doc_type`), и ни один внутренний вид пока не помечен: справочник видов подтверждает заказчик.

### 12.4a. Расширения модели

`documents` (+ реквизиты отправителя/адресата, `response_due_at`, `version`, `content_json`/`content_text`, `template_version_id`, `registration_key`, архивные поля `archived_at`/`archived_by`/`retention_until`/`retention_months`/`is_permanent`, legal hold `legal_hold`/`legal_hold_reason`/`legal_hold_at`/`legal_hold_by`, выбытие `disposition_status`/`disposed_at`/`disposed_by`, взвешенный `search_tsv`).

Новые таблицы (`packages/db/src/schema/docflow.ts`, всего в схеме модуля 26 таблиц):

- `document_collaborators` — соисполнители карточки (§12.5);
- `document_templates` / `document_template_versions` — шаблоны документов и их неизменяемые опубликованные версии (§12.7);
- `resolution_types` — справочник типовых формулировок резолюций (§12.11);
- `resolution_proposals` — проекты резолюций (§12.11);
- `acquaintance_batches` — партии ознакомления: маршрутные, предварительные (gate) и распространение (§12.4, §12.11);
- `document_dispatches` — попытки отправки, они же строки outbox (§12.3, §12.14);
- `archive_disposition_batches` — акты о выделении к уничтожению (§12.12);
- `archive_disposition_items` — состав акта, построчно (§12.12);
- `document_exchange_inbound` — входящие сообщения транспорта до превращения в документ (§12.14);
- `document_exchange_attachments` — вложения таких сообщений (§12.14).

Расширения существующих: `acquaintances` (batch, `status`, `notified_at`), `route_steps` (`activated_at`/`due_at`/`completed_at`, adressee по должности/подразделению, `acted_for`), `nomenclature` (сроки хранения).

`resolutions` — `available_at` (gate предварительного ознакомления, читается очередью «Мои поручения») и колонки приёмки/возврата результата `accepted_at`/`accepted_by`/`returned_at`/`return_comment`, **зарезервированные схемой: ни сервис, ни эндпоинт, ни UI их сегодня не читают и не пишут**. Это известный пробел, а не реализованная возможность: приёмка результата исполнителя пока делается статусом резолюции (`done`) без отдельного акта приёмки.

Комментарии переиспользуют общую `app.comments` с `entity_type='document'`. Полный перечень полей, ограничений и индексов — план §6 и сама схема.

### 12.5. Карточка, редактирование и соисполнители

**Реквизиты корреспондента — snapshot.** `sender_name`/`sender_contact` (входящий) и `recipient_name`/`recipient_contact` (исходящий) хранятся **рядом** со ссылкой `correspondent_id`, а не вместо неё: справочник можно переименовать или слить, но то, что написано на этом письме, меняться от этого не должно. `response_due_at` — срок ответа корреспонденту, отличный от `due_date` (внутренний срок исполнения).

**Редактирование.** Редактируемы только статусы `draft` и `rejected` (отклонение как раз и просит доработку). После регистрации карточка становится записью: правка возвращает `docflow.document.not_editable` (409), исправление реквизитов — отдельное аудируемое действие. Редактировать может автор и соисполнитель с ролью `preparer`/`editor`; канцелярия — **нет**: registry-доступ нужен для поиска и регистрации, а не для правки чужого черновика.

**Оптимистическая блокировка.** `documents.version` инкрементируется на каждой принятой правке; `PATCH` обязан прислать `expectedVersion`. Проверка встроена в предикат `UPDATE` (`where id = ? and version = ?`), поэтому окна между чтением и записью не существует: опоздавшая правка не совпадает ни с одной строкой и возвращает `docflow.document.version_conflict` (409) с `expectedVersion`/`actualVersion`, а работа первого редактора остаётся нетронутой.

**Соисполнители** (`document_collaborators`, роли `preparer|editor|viewer`). Автор остаётся владельцем: соисполнитель **не получает** управление доступом, регистрацию, смену статуса и запуск маршрута и никогда не обходит ДСП allow-list. Управляет составом только автор (или суперадмин). Грант мягко удаляется, поэтому снятая роль остаётся видимой в истории.

**`availableActions`.** Карточка получает от сервера готовый список того, что доступно **этому** вызывающему, и рисует панель действий по нему, а не выводит права заново из статуса и авторства. Расхождение двух выводов — ровно тот механизм, которым появляется кнопка, отклоняемая сервером. Перечень — `DOCUMENT_ACTIONS` в `@cuks/shared`, вычисление — `documentAvailableActions` (`document-actions.ts`); **двенадцать** действий:

| Действие | Кому и при каком состоянии |
|---|---|
| `edit` | автор, суперадмин или соисполнитель `preparer`/`editor`; только статусы `draft` и `rejected` |
| `startRoute` | автор или суперадмин; статус `draft` |
| `register` | `docflow.register` (не `docflow.control`); номер ещё не выдан; статус `draft` или `pending_registration` |
| `changeStatus` | автор/суперадмин или registry-доступ; только если из текущего статуса вообще есть переход |
| `manageAccess` | автор/суперадмин либо `docflow.confidential.view` у того, кто уже видит документ |
| `manageCollaborators` | автор или суперадмин |
| `createResponse` | `docflow.create`; **зарегистрированный** входящий или обращение граждан |
| `dispatch` | `docflow.register`; **зарегистрированный** исходящий, не в архиве |
| `distribute` | автор/суперадмин или registry-доступ; **зарегистрированный** внутренний, не в архиве |
| `archive` | registry-доступ; ещё не сдан в дело; статус `registered`, `in_progress` или `completed` |
| `restore` | registry-доступ; документ в архиве и не прошёл акт (`disposition_status ≠ executed`) |
| `legalHold` | `docflow.archive.hold` |

Соисполнитель намеренно не получает `register`, `changeStatus`, `manageAccess`, `manageCollaborators` и запуск маршрута: подготовитель пишет текст, но расширение круга читателей ДСП, выдача номера и объявление документа завершённым остаются за автором, канцелярией и допущенными.

**Timeline.** `GET /docflow/documents/:id/timeline` — единая лента аудируемых бизнес-событий по карточке, новые сверху, с разрешённым именем актора. Метаданные проходят **allow-list** ключей: аудит пишут многие места, и новое из них не должно иметь возможности вывести на экран содержимое документа, ключ файла или чужой контакт просто фактом своего появления. Правка реквизитов пишет в аудит **имена** изменённых полей (`changedFields`), никогда значения.

### 12.6. Инварианты маршрутов и статусов

**Шаг без исполнителя не создаётся.** Старт маршрута проверяет, что каждый шаг разрешается минимум в одного **действующего** пользователя (не заблокированного и не удалённого): пользователь напрямую, держатели должности или сотрудники подразделения. Иначе — `docflow.route.step_has_no_assignee` (422), и маршрут не создаётся вовсе (проверка до первой записи, вся операция — одна транзакция). Тот же фильтр применяется при разворачивании листа ознакомления.

**Действие строго по виду шага.** Единая таблица `ROUTE_STEP_KIND_ACTIONS` в `@cuks/shared` — источник правды и для серверного гейта, и для кнопок карточки, поэтому UI физически не может предложить действие, которое сервер отклонит:

| Вид шага | Чем завершается | Где выполняется в UI |
|---|---|---|
| `approve` | `approve` | кнопка в строке шага |
| `execute` | `complete` | кнопка в строке шага |
| `sign` | `sign` (ECDSA) | диалог подписи |
| `acknowledge` | `acknowledge` (все назначенные) | лист ознакомления |
| `register` | `register` (регистрация документа) | действие «Зарегистрировать» |

`reject` допустим на любом виде — это универсальный возврат автору. Несовпадение — `docflow.route_step.action_kind_mismatch` (409) с `details.kind/action/allowed`. Строки шагов, завершаемых на своей поверхности, показывают подсказку вместо неработающей кнопки.

Регистрация документа закрывает активный `register`-шаг в **той же** транзакции, что и выдача номера. Завершение маршрута переводит документ в `pending_registration`, **только если номер ещё не выдан** — иначе зарегистрированный документ откатывался бы в «ожидает регистрации» с уже присвоенным номером.

**Закрытие документа доказывает завершённость.** Переход в `completed`/`archived` дополнительно проверяет отсутствие открытых обязательств, считанных под тем же row lock: активные шаги маршрута → `docflow.document.route_open`, неисполненные резолюции → `docflow.document.resolution_open`, неподтверждённые ознакомления → `docflow.document.acquaintance_open` (все 422). Остальные переходы графа не затрагиваются: перевод в `in_progress` при живой резолюции — нормальный случай.

### 12.7. Структурированный контент и шаблоны документов

**Контент — allow-list, а не зеркало редактора.** Тело документа хранится как TipTap/ProseMirror JSON (редактор уже одобрен и используется в чате и задачах — новых зависимостей не потребовалось), но схема в `@cuks/shared` перечисляет **разрешённые** типы узлов (`paragraph`, `heading`, списки, `blockquote`, таблица) и марок (`bold`, `italic`, `underline`, `strike`, `link`). Всё остальное — `iframe`, `image`, произвольный HTML, неизвестный атрибут вроде `onclick` — **отклоняется на записи** (400), а не вычищается при рендере: иначе каждый будущий читатель (экспорт, поиск, интеграция) был бы в одном забытом вызове санитайзера от stored-XSS.

Ограничения: глубина вложенности ≤ 12, размер тела ≤ 512 КБ, заголовки уровней 1–4. Ссылки — только `http`, `https`, `mailto`; схема разбирается так же, как её разбирает браузер (снимаются пробелы и C0-управляющие символы), поэтому `java\tscript:` и ` javascript:` отклоняются наравне с `javascript:`. `content_text` — производное текстовое зеркало для поиска, считается сервером, а не присылается клиентом.

**Шаблоны** (`document_templates` + `document_template_versions`). Шаблон — устойчивая сущность, тело живёт в версиях. **Опубликованная версия неизменяема**: документ хранит `template_version_id`, и сдвиг тела под ним молча переписал бы уже выпущенное. Правка = новая черновая версия + публикация. Повторная публикация той же версии — 409, а не тихий no-op. Снятый с использования шаблон исчезает из выбора, но его версии остаются читаемыми, чтобы выпущенные документы оставались объяснимыми.

**Переменные — подстановка, не вычисление.** Плейсхолдер `{{document.subject}}` заменяется значением из фиксированного серверного контекста. Список переменных **явный** (`document.*`, `author.*`, `org.*`, `correspondent.*` — перечисленные поимённо, не `namespace.*`): контекст собирается из строк БД, и wildcard раскрыл бы ту колонку, которая появится на `users` завтра. Неизвестный плейсхолдер **остаётся в тексте** — автор видит свою опечатку вместо документа с дырой. Подставляются только текстовые листья: плейсхолдер внутри `href` не резолвится никогда, поэтому шаблон нельзя использовать для сборки URL во время рендера. Никакого выражения-языка и никакого `eval` в этом пути нет.

**Редактор.** `DocumentContentEditor` на TipTap; набор расширений подобран **под тот же allow-list**, что и схема хранения, поэтому «что редактор умеет» и «что сервер принимает» — одно решение, а не два расходящихся. Всё, что редактор произвёл, проходит `normalizeDocumentContent` перед отправкой: TipTap законно добавляет атрибуты, которые схема отклоняет (`orderedList.start`, `link.target/rel`, `tableCell.colwidth`), и автор не должен получать 400 за пользование тулбаром. Это **удобство клиента, а не средство защиты** — сервер по-прежнему валидирует и отклоняет. Ссылка с недопустимой схемой теряет марку, но текст остаётся. Сохранение — автосохранение с паузой 1.2 с и явным состоянием в `aria-live` области; незавершённое сохранение сбрасывается при размонтировании. Документ вне редактируемых статусов показывается тем же компонентом в режиме чтения — без тулбара.

**Admin-страница** — вкладка «Шаблоны документов» в настройках ДОУ: создание шаблона, составление следующей черновой версии (посев из текущей), публикация, просмотр версии только для чтения, снятие с использования, предупреждение о неподставляемых переменных.

API: `GET/POST /docflow/document-templates`, `PATCH :id`, `POST :id/versions`, `POST :id/versions/:version/actions/publish`, `POST :id/actions/deactivate`, `POST :id/actions/instantiate`. Чтение — `docflow.use`, управление — `docflow.journals.manage` (шаблон определяет, что выпускает весь комитет), создание документа из шаблона — `docflow.create`.

### 12.8. Замещение и действия «за»

> **О нумерации §12.** В исходной редакции раздел 12.8 отсутствовал — последовательность шла 12.7 → 12.9, и ссылка на §12.8 не разрешалась. Номера **не сдвигались**: на них ссылаются около тридцати комментариев в `apps/api/src/modules/docflow/**`, и перенумерация превратила бы верные ссылки в неверные. Вместо этого пустой номер занят разделом ниже, а §12.4a оставлен на своём месте между §12.4 и §12.5 как расширение модели, а не отдельный этап.
>
> Одна ссылка из кода не разрешается уже сейчас и правится **отдельно, в коде**, а не здесь: `apps/api/src/modules/docflow/exchange/exchange-registry.service.ts` цитирует «docs/modules/11 §12.6» для тезиса «принять отправку, которой не будет, хуже, чем отказать», который живёт в §12.3 и §12.14, — §12.6 посвящён инвариантам маршрутов.

**Замещение — это не роль и не право, а временное расширение того, чем человек действует.** Базовая спецификация — docs/05-auth-rbac.md §6; здесь описано только то, что от неё видно в ДОУ.

Строка `app.substitutions` (`packages/db/src/schema/auth.ts`): `principal_id` (замещаемый), `deputy_id` (заместитель), `scope` `all｜docflow` (default `docflow`), окно `starts_at`/`ends_at` (null с любой стороны = открытая граница), ручной выключатель `is_active`, мягкое удаление. `SubstitutionsService.activePrincipalsFor` считает замещение действующим, если строка активна, не удалена и текущий момент попал в окно; по `scope` он не фильтрует — оба значения дают право действовать в ДОУ, `all` лишь шире за его пределами.

**Разрешение — один раз на запрос, а не построчно.** `RoutesService.actingAssignments(userId)` собирает всё, чем вызывающий действует прямо сейчас: он сам, его должности, возглавляемые подразделения — плюс то же самое у каждого замещаемого. Результат (`ActorAssignments`) отдаётся SQL-предикату видимости (§12.13) и гейтам шагов. Так сделано потому, что правила замещения зависят от времени и построчно в SQL не выражаются: их вычисляют заранее, а запрос только сопоставляет готовый результат.

**«За» фиксируется в данных, а не в тексте.** Шаг маршрута, закрытый заместителем, хранит `route_steps.acted_for`; решение по проекту резолюции — `resolution_proposals.decided_for`. Оба поля — ссылка на замещаемого, поэтому «подписал Иванов за Петрова» остаётся читаемым в истории и после того, как замещение кончилось. Сверх реквизита каждое такое действие пишет **отдельное** аудит-событие `auth.substitution.used` рядом с основным (`routes.service.ts` для шага, `signatures.service.ts` для подписи, `meta.principalId` — за кого): реквизит отвечает на вопрос «чьё это решение», аудит — на вопрос «когда замещением воспользовались». Создание и отзыв делегирования — `auth.substitution.created` / `auth.substitution.revoked` (`substitutions.service.ts`).

**API и экран.** `GET` · `POST /docflow/substitutions`, `DELETE /docflow/substitutions/:id` — гейт маршрута `docflow.use`; построчное правило проверяет сервис: своими делегированиями распоряжается сам замещаемый, чужими — носитель `admin.substitutions.manage`, иначе `docflow.substitution.forbidden`. Экран — `/app/docs/substitutions` (пункт меню под `docflow.use`).

### 12.9. SLA шагов маршрута

**Часы шага идут с его активации, а не со старта маршрута.** `route_steps.activated_at` ставится в момент перехода шага в `active`, `due_at` = `activated_at + due_hours` материализуется тогда же, `completed_at` — при любом терминальном статусе (отдельно от `acted_at`: пропущенный шаг завершается без чьего-либо решения). Иначе длинный первый шаг съедал бы бюджет второго. Материализация, а не вычисление на чтении: развёртке нужен индекс, а срок шага не должен молча сдвигаться при последующей правке шаблона, из которого шаг пришёл. Шаг без `due_hours` часов не получает вовсе — «когда дойдут руки» законный случай, и выдуманный срок наполнил бы развёртку шумом.

**Напоминания** — `docflow.route_deadline` через тот же outbox, что и сроки резолюций (`FOR UPDATE SKIP LOCKED`, экспоненциальный retry, dedupe-ключ). Развёртка меряет **в часах**, а не в душанбинских днях: SLA шага задаётся в часах, и четырёхчасовое согласование, округлённое до календарного дня, не предупредит никого вовремя. `due_soon` (за 4 ч) дедуплицируется по часу — срабатывает один раз в своём окне; `overdue` по душанбинскому дню — ежедневное напоминание, а не ежечасное. ДСП-документ в уведомлении назван только номером.

**Dry-run.** `POST /docflow/documents/:id/route/validate` прогоняет определение маршрута, **ничего не записывая**: возвращает по каждому шагу, кого он реально достанет (должность и подразделение разворачиваются в людей), и стабильные коды проблем (`no_assignee`, `assignee_not_found`), плюс состав параллельных групп. Конструктор в UI показывает это до запуска — автор чинит маршрут здесь, а не встречает одну ошибку при старте без карты остальных, — и кнопка запуска включается только после **успешной** проверки.

**Realtime.** `docflow.route.updated` летит в комнату `entity:document:{id}` при старте маршрута, закрытии шага и отклонении. Подписка (`document.subscribe`) проверяется гейтвеем по **той же базовой видимости**, что и REST-карточка — ДСП остаётся «допуск-список ∩ право», поэтому сокет не становится обходным каналом мимо политики документа. Payload — только идентификаторы и действие; клиент перечитывает карточку через обычный API.

**Шаблоны маршрутов** — вкладка в настройках ДОУ: включение/снятие, удаление, **клонирование**. Полное версионирование намеренно не делалось: запущенный маршрут уже хранит собственный снимок шагов в `route_steps`, поэтому правка шаблона не трогает маршрут в работе — риска, от которого защищало бы версионирование, здесь нет. Канцелярии нужен безопасный способ получить вариант, а это копия. Копия создаётся **снятой с использования**: непроверенный дубликат рядом с оригиналом во всех выпадающих списках — ловушка.

### 12.10. Безопасные defaults

Действуют, пока заказчик не ответит на вопросы плана §15 — и **не блокируют** остальные этапы:

- внутренняя ECDSA CUKS юридически значима в контуре системы; заявление о внешней сертификации не даётся, пока не назван стандарт, юрисдикция и орган;
- исходящая корреспонденция фиксируется **вручную**; SMTP/ведомственный API — optional-адаптеры, включаются только при названном внутреннем сервере (никакого публичного email/SMS/SaaS);
- выбытие из архива — только **логическое**; физическое удаление объектов выключено и требует утверждённой retention-политики;
- адресация шагов маршрута — **snapshot** на момент старта; динамическая адресация по должности включается только явным выбором;
- виды документов и стартовые маршруты берутся из действующего справочника CUKS; новые вводятся после подтверждения заказчиком.

### 12.11. Проект резолюции и предварительное ознакомление

**Решает ровно один названный подписант.** `resolution_proposals` хранит проект (`draft` → `pending` → `approved`/`rejected`), и утвердить или вернуть его может только `signer_id`, его активный заместитель (решение пишется как `decided_for` — «за» кого) либо суперадмин. Права заменить это не могут: резолюция несёт полномочия того, кто её подписал, поэтому `docflow.use` открывает подготовку проекта, но не решение по нему. Возврат обязан содержать причину (`docflow.proposal.not_pending` на повторное решение, `docflow.proposal.signer_mismatch` на чужое). Проект возможен только для **зарегистрированного** документа (`docflow.proposal.document_not_registered`): поручение о ненумерованном черновике ссылалось бы в пустоту. Названный подписант считается участником документа — иначе он получал бы 404 на то, по чему его просят решить.

**Утверждение и gate — одна транзакция.** Approve создаёт резолюцию, партию ознакомления (`acquaintance_batches`) и строки читателей вместе, поэтому поручение не может существовать без охраняющего его gate. Нет читателей — нет и gate: задержка ради пустого ожидания не нужна, `available_at` ставится сразу. Есть читатели — `release_at = now + PT4H` (окно берётся из `DOCFLOW_ACQUAINTANCE_GATE_HOURS`; отдельного runtime-хранилища системных настроек в проекте пока нет), а `my_tasks`/резолюции **не показывают** поручение до снятия gate.

**Снятие gate идемпотентно.** Последнее ознакомление и фоновая развёртка гонятся за одну и ту же партию; побеждает ровно один, потому что `released_at is null` входит в предикат UPDATE, а не проверяется заранее. Причина фиксируется: `all_acknowledged` — все прочли, `timeout` — истёк срок, и тогда неответившие получают `expired`, **никогда не `acknowledged`**: отчёт не должен выдавать пропущенный срок за состоявшееся ознакомление. Развёртка живёт в api (`AcquaintanceGateService`, раз в минуту), а не в воркере — логика гонки одна, и дублировать её значило бы иметь две реализации одного инварианта.

**Realtime.** `docflow.resolution.updated` летит в комнату документа при передаче на подпись, решении и ознакомлении, а при снятии gate — дополнительно в комнату `user:{id}` каждого исполнителя: до этого момента они не могли быть в комнате документа, и «Мои задачи» иначе обновились бы только перезагрузкой. Payload — идентификаторы и действие, как у маршрутного события.

**Справочник типов** (`resolution_types`, вкладка «Типы резолюций» в настройках ДОУ, право `docflow.journals.manage`) задаёт типовые формулировки и то, что форма обязана потребовать: «Исполнить» — исполнителя и срок, «Ознакомить» — ни того, ни другого. Мягкого удаления у таблицы нет: тип, на который ссылаются проекты, удалить нельзя (`docflow.resolution_type.in_use`) — его деактивируют, и история остаётся читаемой.

### 12.12. Архив, сроки хранения, legal hold и выбытие

**Срок замораживается в момент сдачи в дело.** Дело (номенклатура) хранит правило —
`retention_months`, `is_permanent`, «нужен ли акт», — но документ хранит **результат**:
`retention_until`, `retention_months`, `is_permanent` копируются в него при архивировании.
Правило в номенклатуре потом меняют — и это не должно двигать срок уже сданных дел: дата
хранения либо факт, зафиксированный при сдаче, либо она ничего не значит. Отсчёт идёт от
даты архивирования, месяцами (`addMonthsUtc` с зажимом дня: 31 января + 1 месяц = 28/29
февраля), в UTC; на экране — Asia/Dushanbe. Постоянное хранение — `retention_until = null`
и `is_permanent = true`; отсутствие правила у дела — тоже `null`, но `is_permanent = false`:
«вечно» и «срок неизвестен» — разные вещи, и вторая не должна выглядеть первой.

**Архивировать можно только завершённое.** `assertArchivable` требует
зарегистрированный документ в конечном состоянии; черновик или документ на маршруте
получают `docflow.archive.not_archivable`. Возврат из архива (`restore`) обязан нести
причину и сбрасывает срок и статус выбытия — документ снова живой рабочий, а не
полу-архивный. Возврат документа, который уже прошёл акт (`executed`), запрещён.

**Legal hold сильнее всего остального.** Флаг ставится и снимается отдельным правом
(`docflow.archive.hold`), всегда с причиной, и проверяется **в предикате UPDATE** каждой
операции выбытия, а не заранее: между «проверил» и «сделал» hold успевают поставить.
Документ под hold не может стать кандидатом, попасть в акт и быть исполненным по акту —
`executeBatch` перепроверяет hold ещё раз, уже внутри транзакции исполнения.

**Кандидат — это предложение, а не решение.** Ночной sweep воркера помечает
`disposition_status = 'candidate'` только те, у кого срок вышел, и **ни при каких условиях**
постоянные, под hold, не архивированные и уже прошедшие акт. Все четыре запрета повторены
в SQL sweep'а, а не только в политике: у ночного процесса нет второго шанса.

**Акт о выделении — правило двух человек.** `draft` → `pending` → `approved` → `executed`,
и утверждает акт **не его автор** (`docflow.disposition.self_review`, `assertSeparateReviewer`
в `apps/api/src/modules/docflow/archive-policy.ts`). Отклонение
возвращает документы в обычное архивное состояние. Исполнение необратимо на уровне записи
и требует подтверждения в интерфейсе с указанием числа документов.

**Выбытие логическое.** `executed` означает «запись закрыта», а не «файл удалён»: ни один
путь в коде не удаляет объект из хранилища. Так решено не только планом — подпись привязана
к конкретной версии файла, и проверка на `GET /verify/:signatureId` сверяет хэш, поэтому
физическое удаление сломало бы уже выданные подписи. Физическое выбытие **не реализовано и не
скрыто за флагом**: его включение требует сначала утверждённой заказчиком retention-политики
(§12.10), и до тех пор `executed` означает ровно «запись закрыта».

**Опись** (`GET /docflow/archive`, выгрузка `GET /docflow/archive/export`) строится по тем
же правилам видимости, что и список документов: ДСП не появляется в описи у того, кто не
допущен. Выгрузка переиспользует запрос списка, а не спрашивает заново, и при упоре в
собственный лимит говорит об этом строкой — усечённая опись не должна выглядеть полной.

**Один документ — один живой акт, и акт заполняет его автор.** Документ, уже включённый в
действующий акт (`draft`/`pending`/`approved`/`executed`), во второй акт не попадает
(`docflow.disposition.already_in_act`): иначе один акт утверждают, другой отклоняют, и
последнее решение переписывает документ ответом, которого о нём никто не давал. Отклонение
акта **никогда** не трогает документ со статусом `executed` — выбытие для документа
терминально, что бы ни говорил о нём более поздний акт. Заполняет и передаёт акт только его
автор: иначе правило двух человек было бы декоративным — второй мог бы добавить документы в
чужой черновик, передать его и сам же утвердить, а `created_by` по-прежнему называл бы
первого.

**Состав акта — тоже чтение документов.** Право `docflow.archive.dispose` — это учётное
право, а не допуск к ДСП. Добавление документа в акт проходит ту же проверку видимости, что
и открытие карточки, а в составе акта строка, недоступная читателю, **остаётся на месте, но
без реквизитов** (`restricted`): размер акта — факт акта, его ДСП-содержимое — не факт для
этого читателя. Утвердить акт со скрытыми строками нельзя (`docflow.disposition.restricted_items`):
проверять список, который не имеешь права прочитать, — не проверка.

**Перепроверка в момент исполнения.** Между утверждением и исполнением проходят часы и дни:
за это время документ успевают вернуть из архива, поставить под hold или выбыть по другому
акту. Поэтому `executeBatch` перечитывает документы `FOR UPDATE` и прогоняет **всю** политику
выбытия заново, а не только hold.

**Единственный вход в архив — команда сдачи в дело.** Переход `completed → archived` убран из
графа статусов: обычная смена статуса записала бы слово «в архиве» и ни одного факта за ним —
ни даты сдачи, ни замороженного срока, — а выйти из `archived` нельзя, и запись осталась бы
вне описи навсегда. Попытка получает `docflow.document.use_archive_command`, а карточка
больше не показывает кнопку смены статуса там, где граф не даёт ни одного перехода.
Документы, заархивированные так **до** этого релиза, приведены в архив миграцией
`0055_hot_the_watchers`: дата сдачи взята как момент последнего изменения, срок выведен из
дела по тому же правилу, `archived_by` оставлен пустым — выдумывать имя в архиве хуже, чем
признать пробел.

### 12.13. Поиск, dashboard и отчёты реестра

**Один предикат видимости на все выдачи.** До этапа 9 на вопрос «может ли этот человек видеть
этот документ» отвечали три разные реализации: чистая построчная проверка, асинхронный гейт
карточки и предикат, собранный руками внутри запроса списка. Они расходились в обе стороны —
согласующий по маршруту открывал документ по ссылке, но не находил его в реестре, а отчёт по
ознакомлению выбрасывал строки документов, которые читатель мог открыть. Теперь есть один
SQL-предикат `visibleDocumentsWhere`, и реестр, поиск, опись, dashboard и отчёты вызывают
именно его. Внутри он состоит из двух независимых половин, соединённых `AND`.

Первая половина — **кому положено**, и в ней **две альтернативы через `OR`**:

- **участие** (`documentInvolvementWhere`): автор, допуск-список, соисполнитель-collaborator,
  названный подписант проекта, адресат шага маршрута, автор/исполнитель/соисполнитель
  резолюции, назначенный на ознакомление;
- **registry-доступ**: носитель `docflow.register` или `docflow.control` матчится на **каждый
  не-ДСП документ** (`hasRegistryAccess(user) ? ne(documents.confidentiality, 'dsp') :
  undefined`). Это самая широкая ветка предиката, и без неё канцелярия видела бы только то,
  в чём лично участвует, — то есть реестра бы у неё не было.

Вторая половина — **гриф** (`confidentialityGuard`): допуск-список ∩
`docflow.confidential.view`. Гриф — отдельное «И», а не ветка внутри первой половины, именно
для того, чтобы ни одно правило первой половины — ни будущее правило участия, ни широкая
registry-ветка — не могло случайно открыть ДСП: ему придётся пройти через гриф.

Назначения по маршруту приходят **уже разрешёнными** (`RoutesService.actingAssignments`):
правила замещения зависят от времени и не выражаются построчно, поэтому они вычисляются один
раз на запрос, а запрос только сопоставляет результат.

**Поиск** (`GET /docflow/search`) — `websearch_to_tsquery('russian')` по взвешенному вектору
документа (A — тема и номер, B — краткое содержание и снимки отправителя/получателя, C —
текст), плюс три отдельно индексируемые ветки: якорный префикс по регистрационному номеру
(токенизатор никогда не считает `П-2026/0001` одним словом, а номер вставляют целиком), имя
корреспондента через его собственный вектор и текст **текущих** вложений через
`file_versions.extracted_tsv` — тот же индекс, который уже ведёт модуль файлов. Одно общее
`OR` по всем поверхностям ни один индекс обслужить не может, поэтому каждая ветка сохранена
самостоятельной.

Фильтр видимости — **внутри** запроса, а не после него: выдача, отфильтрованная снаружи, врёт
в `total`, врёт в пагинации и течёт по времени ответа. «Сколько всего нашлось» — это тоже
раскрытие.

**Сниппет — сегменты, а не разметка.** `ts_headline` оборачивает совпавшие слова, но **не**
экранирует текст вокруг них, поэтому отдавать его как HTML значило бы позволить документу
отрисовать собственный `<script>` в чужой выдаче. Сервер отдаёт массив отрезков с флагом
`hit`, клиент рендерит текст как текст. Сниппет строится **только** из собственных полей
документа: у вложения свой гейт доступа, а сниппет — это копия текста.

**Сортировка — allow-list.** Имя колонки от клиента никогда не попадает в SQL строкой: DTO
принимает только перечисленные имена, а таблица в `document-sort.ts` — единственное место,
которое превращает имя в колонку. Каждый порядок заканчивается уникальным тай-брейкером по
`id`: без него «страница 2» реестра, где полсотни документов созданы в одну секунду, — не
обещание, а лотерея, и строка может попасть на обе страницы или ни на одну.

**Rate-limit поиска** — собственный бюджет (60 запросов в минуту на `/search`, 120 на
`/search/quick` — `document-search.controller.ts`), а не общая читательская квота: поиск —
самое дорогое чтение в продукте и единственное, которое отвечает «сколько всего». Ключей
**два, и пройти надо оба** (`ThrottleGuard`, `apps/api/src/common/guards/throttle.guard.ts`):
ведро по `request.ip` — потолок, единственный ключ, который вызывающий не выбирает сам, и
ведро по сессионной cookie — сверху, ради справедливости за одним офисным NAT, где
IP-ведро значит, что один быстро печатающий человек тратит бюджет всего этажа. Cookie
подделывается, поэтому её ведро умеет только ужесточать лимит, но не ослаблять его.

**«Требует внимания»** — восемь очередей, каждое число ведёт в список, который его породил.
Очередь, которую вызывающему видеть не положено, **отсутствует** в ответе, а не приходит нулём:
«Кандидаты к выбытию: 0» всё ещё отвечает на вопрос «а есть ли такая очередь». Счётчики
считает база: раньше значки очередей вытягивали все совпавшие идентификаторы и брали
`.length`.

**Пять отчётов реестра** (`GET /docflow/reports/register?kind=…`) — движение, регистрация,
сроки, отправка, архив. План называет их и не задаёт ни колонок, ни группировок, поэтому
каждый определён вопросом, на который отвечает, а выбор записан в STATUS. Формат строки общий:
пять отчётов с пятью формами строки — это пять экранов, пять выгрузок и пять наборов тестов
там, где есть одна таблица с разным вопросом над ней. API отдаёт **ключи** колонок, не текст.
«Сроки» меряют реестр по его собственным датам, а не людей по выданным поручениям (это
существующий отчёт дисциплины), и они расходятся намеренно: документ может быть просрочен,
когда все поручения по нему исполнены.

**Сохранённые представления реестра** живут в общей таблице `app.saved_filters` под
дискриминатором `docflow_documents` — там же, где представления реестра ЧС и пресеты
конструктора отчётов (docs/07 §saved_filters). Своя таблица `docflow.saved_searches` была бы
третьей копией тех же четырёх колонок со своим мягким удалением и своими ошибками.

Представление хранит **фильтры**, а не строки и не идентификаторы строк — и именно это делает
общий доступ безопасным: список, который открывает чужой пресет, строится с видимостью
**читателя**, поэтому «Все ДСП за март» покажет каждому только те, к которым он допущен, а
человеку без допуска — ничего. Сам пресет ни о чём не сообщает: набор фильтров не является
утверждением о том, что по ним что-то найдётся.

Ключи `params` — allow-list, тот же, что читает список. Колонка `jsonb`, а содержимое пресета
рано или поздно оказывается в query string чужого браузера, поэтому неизвестный ключ
отклоняется DTO при записи и отбрасывается ещё раз при чтении: строка может быть старше
текущего списка ключей. Чужое общее представление доступно только для применения —
переименовать или удалить его может лишь автор, и это проверяет сервер, а не интерфейс.

Фильтры реестра переехали в URL. Это не косметика: панель «Требует внимания» ведёт по ссылке в
срез, который сама посчитала, ссылку на срез можно отправить коллеге, а «Назад» означает
предыдущий фильтр, а не предыдущую страницу. Действующие фильтры показаны чипами с
индивидуальным снятием — «что именно сейчас применено» должно читаться с одного взгляда, а не
собираться по выпадающим спискам.

### 12.14. Интеграционный контур: порт, адаптеры, обмен

**По умолчанию не подключено ничего.** CUKS работает в изолированной сети и не обращается ни к
какому внешнему сервису; машинные каналы (`email`, `integration`) отказываются заранее с
`docflow.dispatch.channel_unavailable`, пока не настроен локальный транспорт — принять
отправку, которой не будет, хуже, чем отказать. Ручные каналы — курьер, почта, лично — работают
полностью и этим контуром не затронуты.

**Оговорка к этапу 6.** Чекбокс «adapter interface для email/integration» был отмечен
выполненным, но интерфейса не существовало: приватный массив каналов и `registerAdapter`,
которого никто не вызывал, то есть каналы отказывались *безусловно*, а не «до настройки».
Настоящий `DocumentExchangePort` появился только здесь.

**Порт — граница, а не библиотека.** Через него ходят простые данные: ни соединения с БД, ни
контекста запроса, ни `AuthUser`. Адаптер, способный дотянуться до реестра, мог бы писать
документы мимо регистрации, видимости и аудита — а изоляция ровно в том, что транспорт этого
не может. Ожидаемые сбои возвращаются результатом, а не исключением: «внешняя система
недоступна» — это состояние, которое канцелярия должна **видеть** и повторить, а не ошибка,
роняющая запрос.

**Реестр адаптеров строится из окружения при старте и больше нигде.** Ни таблицы настроек, ни
эндпоинта, который установит транспорт: подключаемый через форму канал вывода — не то, что
изолированная установка должна уметь.

**Как включить и где смотреть.** Четыре переменные окружения (`apps/api/src/config/env.ts`):

| Переменная | Default | Что делает |
|---|---|---|
| `DOCFLOW_EXCHANGE_DIR` | не задана | Каталог эталонного folder-адаптера. **Не задана — адаптеров нет**, и это shipped-состояние: машинные каналы отказываются с `docflow.dispatch.channel_unavailable`. |
| `DOCFLOW_EXCHANGE_MAX_ATTACHMENT_MB` | 50 | Потолок одного вложения обмена. |
| `DOCFLOW_EXCHANGE_POLL_SECONDS` | 60 | Как часто входящий поллер заглядывает в папку. |
| `DOCFLOW_EXCHANGE_MAX_ATTEMPTS` | 5 | Бюджет попыток до dead-letter. |

Наблюдаемость контура ровно одна: `ExchangeRegistryService.status()` опрашивает каждый адаптер
(`probe()`), и результат попадает на админский экран здоровья — `/app/admin/health`, право
`admin.system.monitor` (`apps/api/src/modules/monitoring/admin-health.service.ts`). Наружу
переходит **только состояние**: ни пути, ни хоста, ни секрета. «Не настроен» — это `state: down`
с пометкой `not-configured`, и такая пометка исключена из общего статуса: установка без
транспорта не должна выглядеть вечно больной.

**Эталонный адаптер — наблюдаемая папка** на том же сервере: `out/` для исходящих, `in/` для
входящих, `done/` и `rejected/` для разобранных. Это не заглушка — оператор кладёт скан в `in/`,
и письмо приходит в реестр. Путь во вложении, выводящий за пределы `in/`, отбрасывается;
слишком большое вложение пропускается; один нечитаемый конверт не блокирует очередь за собой.

**Строка отправки И ЕСТЬ строка outbox.** Ожидающая машинная попытка с наступившим
`next_attempt_at` — это ровно «что осталось отправить». Отдельная таблица outbox была бы вторым
местом, где живёт тот же факт, и рано или поздно они разошлись бы в ответе на вопрос, ушло
письмо или нет.

Захват — `FOR UPDATE SKIP LOCKED`, и он фиксируется **до** вызова адаптера: зависший транспорт
не должен держать транзакцию, а падение посреди отправки должно оставить попытку захваченной, а
не свободной для второго экземпляра. Цена выбора: падение между «транспорт принял» и «строка
обновилась» приведёт к повторной отправке. Это правильная сторона ошибки — письмо, ушедшее
дважды, неловко; письмо, молча не ушедшее, срывает срок.

**Повторы**: 30 с с удвоением до потолка в 30 минут, бюджет — пять попыток. **Неповторяемый**
сбой уходит в dead-letter сразу, каким бы ни был бюджет: отказавший адрес не становится верным
от пятикратной попытки. Попытка никогда не бывает одновременно запланированной и
dead-lettered — эти состояния отвечают на вопрос «кто владеет письмом», машина или человек, и
оба сразу означали бы, что машина повторяет то, что уже чинит оператор. Повтор несёт `attempt_no`
и `retry_of` колонками, а не метаданными аудита.

**Входящее сообщение — не документ.** Оно хранится сообщением, вложения проходят ту же
антивирусную очередь, что и обычная загрузка, и только когда всё сошлось, становится
зарегистрированным документом. Зарегистрировать сначала, а проверить потом — значит поставить
номер на том, что может оказаться заражённым файлом от неизвестного отправителя, а номер назад
не берут.

Дедупликация — работа базы, не адаптера: `(adapter_id, external_id)` уникален, вставка идёт
`onConflictDoNothing`. Транспорт, доставивший повторно — после перезапуска или потому, что
подтверждение не дошло, — во второй раз не вставляет ничего, и эта гарантия не зависит от того,
помнит ли адаптер что-либо между перезапусками.

Типы вложений — **allow-list**, а не список запрещённых: список запрещённых обязан быть прав
про каждый исполняемый формат вечно, атакующему достаточно одного забытого. Отказ окончателен —
исполняемый файл не становится приемлемым оттого, что на него посмотрел человек, — но само
сообщение записывается: оператор должен видеть, что пришло и почему отклонено. Отклонённые
байты в хранилище не попадают.

Порядок допуска к регистрации: заражение, затем скан, затем справочные данные. «AV до
регистрации входящего вложения» — это не «AV когда-нибудь»: случай `pending` не может
провалиться в регистрацию ни при какой комбинации остальных условий. Неузнанный отправитель
уходит в карантин, а не угадывается: сопоставление точное, без учёта регистра и пробелов —
подшить официальное письмо не тому корреспонденту хуже, чем спросить человека.

`file_versions.uploaded_by` стал nullable: у версии, пришедшей транспортом, нет человека за
спиной, и назвать кого-то означало бы внести ложь в аудит.

**Что остаётся за заказчиком** (плана здесь недостаточно, и выдумывать нельзя): SMTP-адаптер —
только при названном внутреннем сервере и правилах; ведомственный API — транспорт, схема
сообщения, аутентификация вызывающего; mTLS и хранилище секретов — ни клиентских сертификатов,
ни vault в стеке нет; ключ сопоставления внешнего корреспондента (ИНН/ведомственный код) — без
него карантин не может закрываться автоматически.

**Очередь разбора** (`/app/docs/exchange`, право `docflow.register`) — экран, на котором
человек отвечает ровно на те вопросы, которые машина отказалась угадывать: кто отправил письмо
и какого оно вида. Всё остальное — номер, дата, запись в аудите — берётся из обычной команды
регистрации входящего, поэтому пришедшее транспортом письмо в реестре неотличимо от
принесённого на бумаге. Вторая точка регистрации рано или поздно начала бы выдавать номера по
другим правилам, чем счётчик, которому доверяет канцелярия.

Идентификатор сообщения служит ключом идемпотентности регистрации: зарегистрировать одно и то
же письмо дважды нельзя, что бы ни сделал двойной клик или повторённый запрос.

Ответы формы закрывают вопрос о справочных данных, но **не** закрывают незавершённый скан и не
отменяют заражения — эти два состояния блокируют регистрацию, и сервер отказывает так же, как
экран прячет кнопку: решение принимает одна и та же функция `planPromotion`, поэтому интерфейс
и API не могут разойтись. Рядом с выключенной кнопкой написано, почему она выключена:
выключенный элемент без объяснения читается как сломанный экран.

Отклонение требует причины и не трогает уже зарегистрированное сообщение: реестр и очередь не
должны рассказывать про одно письмо разные истории.
