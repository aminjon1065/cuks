# Модуль 12. Файловый менеджер

Корпоративное хранилище: личные файлы, общие папки подразделений, шаринг, версии, предпросмотр, корзина. Инфраструктурно — фундамент для вложений всех модулей (документы, чат, задачи, ЧС, записи встреч).

## 1. Права
`files.use` — базовое (личное пространство + доступное по шарингу). `files.org.manage` — управление общими папками своего подразделения. ACL на папки/файлы: `viewer` (просмотр/скачивание) / `editor` (+загрузка, версии, переименование) / `manager` (+доступ, удаление). Субъекты ACL: пользователь, подразделение, роль.

## 2. Разделы UI
- **Мои файлы** — личное дерево пользователя.
- **Общие** — папки подразделений (корень на подразделение создаётся автоматически; видимость по членству + ACL).
- **Доступные мне** — всё, чем поделились.
- **Последние** — недавно открытые/изменённые.
- **Корзина** — свои удалённые, восстановление, автоочистка 30 дней (retention job).

## 3. Модель данных (`app`)

**fs_nodes** (единое дерево папок и файлов): id, parent_id null, kind `folder|file`, name, space `personal|org|system` (system — вложения модулей), owner_user_id null, owner_org_unit_id null, current_version_id null (для file), size_cached, mime, tags text[], starred_by uuid[], deleted_at (корзина), path materialized для быстрых прав/крошек.

Поиск — **три независимых механизма, а не один общий вектор**: `fs_nodes.search_tsv` (generated column только по `name`, GIN), `file_versions.extracted_tsv` (generated column по `extracted_text` текущей версии, GIN) и ветка `ILIKE` по `unnest(tags)`. Теги в generated-вектор положить нельзя: `array_to_string` — STABLE, а не IMMUTABLE (`packages/db/src/schema/fs.ts`). Запрос объединяет три ветки через UNION, чтобы каждый GIN-индекс был применим (`apps/api/src/modules/files/file-search.service.ts`); одиночный OR по трём источникам вырождается в seq scan.

**file_versions**: node_id, version int, storage_key (MinIO), size, mime, checksum_sha256, uploaded_by **null**, av_status `pending|clean|infected`, extracted_text (для поиска, из worker), created_at. Текущая — по current_version_id; старые доступны в истории («сделать текущей» = новая версия-копия).

`uploaded_by` nullable с этапа 10 СЭД: версия, пришедшая транспортом обмена документами, не имеет за собой человека, и назвать кого-то означало бы записать ложь в аудит-след (`packages/db/src/schema/fs.ts`, продюсер — `apps/api/src/modules/docflow/exchange/exchange-receiver.service.ts`). Практическое следствие: уведомление о заражённом файле для такой версии уходит только суперадминам — загрузчика, которого можно предупредить, просто нет (`apps/worker/src/queues/av-scan/av-scan.processor.ts`, `notifyInfected`).

**file_shares** — реализуется через общий `resource_acl` (resource_type `folder|file`) + **file_links**: node_id, token, expires_at null, created_by — внутренняя ссылка «для всех аутентифицированных, у кого есть ссылка» (внешних анонимных ссылок в v1 нет — закрытый контур).

Вложения модулей: модуль создаёт node в space=system с привязкой через своё поле file_id/`document_files` и т.п.; такие файлы не видны в дереве файлового менеджера (`GET /files/tree` для system-пространства отвечает ошибкой `files.tree.system_not_browsable`), но используют ту же машинерию (версии, AV, превью, presigned).

### 3.1. Усыновление файлов документа (СЭД)

Для документов схема сильнее, чем «модуль создал node в system»: файл сначала загружается **обычным пайплайном в личное пространство**, а при прикреплении к документу сервер **переносит узел** в системное дерево (`adoptDocumentFile`, `apps/api/src/modules/docflow/docflow-files.service.ts`):

- узел переезжает в `system/<DOCFLOW_FILES_ROOT_NAME>/<documentId>/` — корневая папка называется `docflow` (`packages/shared/src/constants/index.ts`), папки создаются лениво под транзакционным advisory-lock;
- переписывается `path`, а `owner_user_id` и `owner_org_unit_id` **обнуляются оба**.

Что из этого следует и чего иначе из спеки не вывести:

- файл **уходит из личного дерева загрузившего** и перестаёт считаться в его квоте (квота суммируется по владельцу, а `assertQuota` для `space='system'` вообще возвращается сразу — `apps/api/src/modules/files/fs-nodes.service.ts`);
- загрузивший **больше не может** удалить, переместить или переподелиться телом зарегистрированного документа: владельца у узла не остаётся, а личное правило доступа (`space='personal'` + `owner_user_id`) перестаёт срабатывать;
- **но усыновление не снимает уже выданный доступ.** `adoptDocumentFile` меняет только `space`, `parent_id`, `path` и обнуляет обоих владельцев — из `resource_acl` и `file_link_grants` не удаляется ничего. Грант или принятая внутренняя ссылка, выданные, пока файл лежал в личном пространстве, переживают перенос: `FsNodesService.hasAccess` передаёт id самого узла в `AclService.checkNodeAccess` и проверяет `hasActiveLinkGrant` по тому же id (`apps/api/src/modules/files/fs-nodes.service.ts`). Коллега, с которым файлом поделились **до** прикрепления, продолжает скачивать тело — в том числе тело ДСП-документа — через общий `GET /files/:id/download`, и записи в read_log при этом не появляется (§8.2). Отзыв таких грантов при усыновлении **не реализован**; «доступ решает только политика документа» верно лишь для файла, которым до прикрепления не делились;
- операция **идемпотентна** — узел, уже лежащий в нужной папке, не трогается; поэтому и повторное прикрепление, и бэкфилл безопасно перезапускаются;
- усыновление вызывают **все три** пути прикрепления: `DocumentsService.addFile`, регистрация входящего (`DocumentsService.registerIncoming`) и подтверждение отправки с квитанцией (`DispatchesService.confirm`, поле `receiptFileId` — `apps/api/src/modules/docflow/dispatches.service.ts`).

Разовая миграция для документов, созданных до этого поведения:
`pnpm --filter @cuks/db backfill:docflow-files [-- --dry-run] [-- --batch=N]`
(`packages/db/src/scripts/backfill-docflow-files.ts`) — коммит по одному документу, повторный запуск no-op, прерванный возобновляется простым перезапуском.

## 4. Загрузка и скачивание

- Presigned multipart upload в MinIO напрямую (чанки 16 МБ, параллельно 3, retry чанка). Пайплайн: `POST /files/uploads` (имя, размер, parent) → presigned URLs → загрузка → `POST /files/uploads/:id/complete` → node+version и **единственная** постановка в очередь — `av-scan` (`enqueueAvScan`, `apps/api/src/modules/files/uploads.service.ts`; другой очереди сервис и не знает). `preview` и `text-extract` ставит уже сам процессор антивируса и только после чистого вердикта по неустаревшей версии (`apps/worker/src/queues/av-scan/av-scan.processor.ts`): `preview` — для `image/*`, `text-extract` — для PDF и DOCX. Цепочка нагружена смыслом: заражённая версия и версия, перекрытая новой, не получают ни превью, ни извлечённого текста.
- Drag-n-drop папок (webkitdirectory) — создание структуры. Прогресс-бар в глобальном тосте (можно уйти со страницы).
- Лимиты (`packages/shared/src/constants/index.ts`): файл ≤ 2 ГиБ (`MAX_FILE_SIZE_BYTES`), квота личного пространства по умолчанию 10 ГиБ (`DEFAULT_PERSONAL_QUOTA_BYTES`, переопределяется колонкой `users.quota_bytes` — админского UI для правки пока нет, см. `docs/modules/16-admin.md` §1), квота подразделения (`org_units.quota_bytes`, по умолчанию не ограничена). Индикатор квоты в сайдбаре раздела.
- Скачивание: `GET /files/:id/download` → 302 на presigned (5 мин), аудит. Массового zip-скачивания **нет** (см. §10): ни очереди, ни эндпоинта не реализовано.

## 5. Предпросмотр
- Изображения (sharp-превью 3 размеров), PDF (встроенный просмотрщик pdf.js на весь экран с миниатюрами страниц), видео/аудио (нативный плеер, HTTP range из MinIO), txt/md/код (подсветка). DOCX/XLSX v1 — карточка «скачать» (+extracted_text в поиске); ONLYOFFICE — v2.
- Быстрый просмотр — Space/двойной клик → полноэкранный оверлей с стрелками по списку.

## 6. Экран (`/app/files`)
- Слева — дерево разделов/папок. Центр — DataTable (имя+иконка типа, размер, изменён, автор) с переключателем таблица/сетка (сетка — превью-плитки). Хлебные крошки. Правая панель — инспектор выбранного: превью, метаданные, версии, доступ, связи, активность.
- Тулбар: Загрузить / Новая папка / фильтры (тип, автор, период) / поиск в текущей папке и глобально.
- Контекстное меню строки: Открыть, Скачать, Поделиться, Переместить (диалог-дерево), Переименовать (inline), Звезда, Версии, В корзину.
- Мультивыбор: shift/ctrl, массовые действия в тулбаре. DnD-перемещение внутри дерева.
- Диалог «Поделиться»: поиск пользователя/подразделения → уровень доступа; список текущих доступов; «внутренняя ссылка» с копированием; наследование от папки (бейдж «унаследовано»).

## 7. API (основное)

Всё под правом `files.use` (`apps/api/src/modules/files/files.controller.ts`):
```
GET /files/tree?space&parentId&orgUnitId   GET /files/:id   POST /files/folders
POST /files/uploads → POST /files/uploads/:id/complete | POST /files/uploads/:id/abort
GET /files/:id/download   GET /files/:id/preview?size
PATCH /files/:id (rename/move/tags)   DELETE /files/:id (в корзину)   POST /files/:id/restore
GET /files/:id/versions   POST /files/:id/versions/:version/restore
GET/PUT/DELETE /files/:id/acl
GET/POST /files/:id/links   DELETE /files/:id/links/:linkId   POST /files/links/:token/accept
GET /files/shared («Доступные мне»)   GET /files/recent?limit   GET /files/trash?space&orgUnitId
GET /files/quota?space&orgUnitId   GET /files/search?q&limit
```
Отдельного `POST /files/:id/versions` **нет**: новая версия — это тот же upload с `targetNodeId` существующего файлового узла (`POST /files/uploads` → `/complete`, `apps/api/src/modules/files/uploads.service.ts`).

### Файлы документа (СЭД)

Для усыновлённого файла (§3.1) это основные пути чтения: владельца у узла нет, поэтому на общих `/files/:id/download` и `/files/:id/preview` `FsNodesService.assertAccess` отказывает всем — кроме суперадмина и кроме тех, у кого остался ACL-грант или принятая внутренняя ссылка, выданные до прикрепления (эта дыра описана в §3.1).
```
POST /docflow/documents/:id/files                      docflow.create
GET  /docflow/documents/:id/files/:fileId/download     docflow.use → 302 presigned
GET  /docflow/documents/:id/files/:fileId/preview?size docflow.use → 302 presigned
```
Гейт чтения (`DocflowFilesService.resolve`, `apps/api/src/modules/docflow/docflow-files.service.ts`) отрабатывает по порядку:
1. `documents.assertVisible` — невидимый документ и ДСП без allow-list дают **404, а не 403**, чтобы по id файла нельзя было выяснить, существует ли документ;
2. связь `document_files` должна принадлежать **именно этому** документу — валидный `fileId` из чужого документа в паре с видимым документом тоже 404;
3. AV-вердикт (§8);
4. только после этого — короткоживущий presigned URL; постоянная ссылка на объект наружу не выдаётся никогда.

`set-main` и `DELETE /docflow/documents/:id/files/:fileId` планировались, но **не реализованы**.

## 8. Фоновые задачи / события / аудит

Jobs: `av-scan`, `preview`, `text-extract` (pdf-parse, mammoth), `retention` (корзина 30 дн, temp-uploads 24 ч, плюс протухшие ссылки, записи встреч и застрявшие сканы). Очереди `zip-bundle` не существует (`packages/shared/src/queues/index.ts`). События: `files.file.shared` → уведомление получателю.

### 8.1. Две политики антивируса

Политики **две, и разница между ними — инвариант безопасности**:

- **Файловый менеджер** (`FsNodesService.getDownloadUrl`/`getPreviewUrl`): блокируется только `infected`. Файл в статусе `pending` (ещё не просканирован) скачивается нормально — это осознанно: файл читает прежде всего сам загрузивший, а предупреждение о непроверенном файле, если оно нужно, делается на уровне UI по тому же `avStatus`.
- **Файлы документа** (`assertVersionServable`, `apps/api/src/modules/docflow/docflow-files.service.ts`): отдаётся только `clean`; `pending`, `infected` и отсутствующая версия — все три дают **403 `docflow.file.not_safe`**. Причина: тело документа доходит до каждого участника маршрута, каждого ознакомляемого и всей канцелярии. Тот же гейт стоит на машинной отправке (`resolveOutboundAttachments`): непросканированное вложение **отказывается покинуть контур**, а не молча выпадает из письма.

Строгий гейт СЭД восстановим, а не вечен: версия, застрявшая в `pending` дольше `STALE_PENDING_SCAN_HOURS` (1 ч), переэнкюивается ночной свёрткой retention (`reconcileStalePendingScans`, `apps/worker/src/queues/retention/retention.processor.ts`, cron `0 3 * * *`) — то есть восстановление отложенное, до ближайшей ночи.

### 8.2. Аудит и read_log

Действия аудита у двух путей **разные**:

- файловый менеджер — `files.file.downloaded`, `entityType: 'file'`;
- файл документа — `docflow.document.file_downloaded`, `entityType: 'document'`, `meta: {fileId, versionId, mode: 'download'|'preview'}`.

Остальное — upload/share/delete/restore по файловому менеджеру.

**Граница read_log для ДСП.** Пишут в read_log **два** места: открытие карточки ДСП-документа не его автором (`DocumentsService.detail`, `apps/api/src/modules/docflow/documents.service.ts`) и эндпоинты файлов документа (`DocflowFilesService.recordRead` — единственный вызов `ReadLogService.record('document', …)` на пути чтения файлов). Общий файловый API её не пишет, а суперадмин им пользоваться может: `FsNodesService.hasAccess` возвращает `true` для `user.isSuperadmin` безусловно, поэтому суперадмин способен скачать усыновлённое тело ДСП-документа через `GET /files/:id/download`, и в след попадёт только обычный `files.file.downloaded`. То же верно для держателя до-усыновительного ACL-гранта или ссылки (§3.1). Это принятые исключения, а не полное покрытие read_log — утверждать обратное нельзя. При этом `docs/09-security.md` §3 их **не оговаривает** и требует записи на каждое открытие/скачивание ДСП: расхождение спек зафиксировано здесь и не закрыто.

## 9. Критерии приёмки
- Файл 1.5 ГБ загружается с прогрессом и докачкой после обрыва сети (тест вручную + чанк-retry unit).
- Права: viewer не может загрузить, non-member не видит папку по прямому URL (e2e 403).
- Версии: загрузка того же имени → новая версия по подтверждению; восстановление старой работает.
- Превью PDF/изображений открываются < 1 с (кэш превью).
- Корзина: удаление → восстановление → окончательное удаление по retention (тест с фейк-временем).
- Инфицированный EICAR-файл блокируется, уведомление приходит суперадминам и загрузившему; у версии, пришедшей транспортом обмена (`uploaded_by is null`), загрузившего нет — уведомляются только суперадмины.
- Файл документа: `pending` и `infected` одинаково дают 403 `docflow.file.not_safe` на download, preview и машинной отправке; общий `/files/:id/download` для усыновлённого узла недоступен обычному пользователю (при условии, что файлом не делились до прикрепления, — §3.1).

## 10. V2+
ONLYOFFICE-редактирование, WebDAV-монтирование, внешние ссылки с паролем, полнотекст OCR сканов, массовое скачивание zip-стримом (нет ни очереди, ни эндпоинта).
