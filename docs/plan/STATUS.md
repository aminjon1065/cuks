# STATUS — журнал прогресса

> Обновляется ИИ-агентом в конце каждой сессии. Единственный источник правды о состоянии кода.

## Текущее состояние

- **Фаза**: 2 (ГИС/аналитика) — задачи 2.1–2.2 готовы
- **Последняя сессия**: 2026-07-14 — задача 2.2 (Martin MVT + токен-авторизация + PMTiles)
- **Ветка**: main

## Прогресс по фазам

Чекбоксы задач — в `ROADMAP.md` (агент отмечает их там). Здесь — сводка:

| Фаза              | Статус                       | Принята заказчиком |
| ----------------- | ---------------------------- | ------------------ |
| 0 Фундамент       | 🟢 задачи 0.1–0.14 + демо-сиды | приёмка: критерии выполнены, финальный ОК заказчика — открыт |
| 1 Файлы           | 🟢 задачи 1.1–1.9 готовы      | приёмка §9: критерии закрыты, финальный ОК заказчика — открыт |
| 2 ГИС/аналитика   | 🟡 задачи 2.1–2.2 готовы       | —                  |
| 3 Документооборот | ⬜                           | —                  |
| 4 Задачи          | ⬜                           | —                  |
| 5 Чат             | ⬜                           | —                  |
| 6 Звонки          | ⬜                           | —                  |
| 7 Hardening       | ⬜                           | —                  |

## Журнал сессий

<!-- Новые записи СВЕРХУ. -->

### 2026-07-14 — Фаза 2: задача 2.2 (Martin MVT + токен-авторизация тайлов + PMTiles)

**Сделано** (по `docs/modules/10` §4/§9, `docs/08`, `docs/02` ADR-7/10/12):

- **Martin** (`ghcr.io/maplibre/martin`, v1.12): сервис в `compose.dev` (host-порт 3001), конфиг
  `infra/martin/config.yaml` — авто-публикация схемы `gis` (admin_units/facilities/risk_zones/
  layer_features как MVT) + PMTiles-подложка из `/basemap`. **Миграция `0012`**: SQL-функция
  `gis.incidents_mvt(z,x,y,params)` (ST_AsMVT над `app.incidents`, фильтры status/severity/type).
- **Токен-авторизация тайлов** (api `GisModule`): `TileTokenService` (HMAC-SHA256 `node:crypto`,
  ключ scrypt из SESSION_SECRET, TTL 1ч, timing-safe verify); `GET /gis/tile-token` (право
  `gis.view` → `{token, expiresAt}`); `GET /gis/tile-auth` (`@Public`, цель Caddy forward_auth:
  токен из `?token=` или `X-Forwarded-Uri` → 200/401). `@cuks/shared`: `TILE_TOKEN_TTL_SECONDS`,
  `TileTokenResponse`.
- **Прод-контур**: `infra/caddy/Caddyfile` — `handle_path /tiles/*` → `forward_auth api
  /api/v1/gis/tile-auth` → `reverse_proxy martin:3000` (+ /api, /socket.io, /geoserver, SPA).
  compose.prod целиком — задача 7.1; Martin в проде наружу не публикуется.
- **PMTiles-подложка**: `infra/scripts/build-basemap.sh` — извлечение bbox Таджикистана из
  planet-сборки Protomaps через `pmtiles` CLI → `infra/basemap/region.pmtiles`.
- **Dev**: vite-прокси `/tiles` → martin (со срезом префикса). В dev нет Caddy → токен-гейт не
  форсируется (документировано); enforcement — прод-Caddy.

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные; юнит `TileTokenService` 5/5 (подпись/
verify/expiry/tamper/чужой ключ). **Live против реального стека**: Martin отдаёт MVT — каталог из 5
источников; `admin_units/6/44/23` → 200, 441 Б; `incidents_mvt` с тестовым ЧС → 197 Б, фильтры
status/severity/type корректны; выдача токена (gis.view) + `tile-auth` → 200 (и `?token=`, и
`X-Forwarded-Uri`), плохой/пустой → 401; web-прокси `/tiles`→martin → 200.

**Adversarial-review** (воркфлоу: 3 измерения — token-security, martin-sql, infra-wiring): **7 находок
→ 2 подтверждено (обе low), 5 рефутировано**, исправлены:

- **[low]** Токен утекал в логи api через неотредактированный `X-Forwarded-Uri` (реплеебелен в
  пределах TTL). Исправлено: `x-forwarded-uri` добавлен в pino-redact.
- **[low]** Мусорный `?severity=abc`/`''` крэшил `::int` → Martin 500. Исправлено (миграция `0013`):
  фильтры парсятся в локали, каст guard'ится `pg_input_is_valid` (PG17) — плохой ввод игнорируется.
- **[refuted, но дёшево]** SIGPIPE в `build-basemap.sh` (`pmtiles show | head` + pipefail) →
  ложный fail. Исправлено `|| true`.

**Рефутировано ревью (корректно)**: layer_features без per-layer-ACL (enforcement — позже; auto-publish
осознан); LIKE-метасимволы в type (значение bound, не инъекция); отсутствие margin у tile-envelope
(точки не клипаются); Martin TileJSON base_path (карта 2.3 использует явные URL-шаблоны, тайлы live-ОК).

**Решения**:
- **Токен — bearer-capability по expiry** (без привязки к user/session/IP), stateless-verify: дёшево,
  read-only, TTL 1ч. Привязка/cookie — при ужесточении (7.5). В dev гейт не форсируется (нет Caddy).
- **Martin публикует только схему `gis`** (`app` приватна); ЧС — через `gis.incidents_mvt` (читает
  `app.incidents`, но наружу — только нужные поля).
- **Известное (для 2.7 QGIS-путей)**: у gis-таблиц `id` — клиентский default drizzle (uuidv7), нет
  БД-default → прямой INSERT из QGIS/сырого SQL требует явного `id`. Адресуется при вводе
  QGIS-editor-учёток (2.9) — БД-default/инструкция.
- **Basemap-скрипт документирован, здесь не прогонялся** (нужен `pmtiles` CLI + planet-сборка) — как
  seed-geo/бэкап-скрипты.

### 2026-07-13 — Фаза 2: задача 2.1 (схема gis/incidents + классификатор + admin_units)

**Сделано** (по `docs/modules/10` §3, `docs/07` §gis; схема+сиды, DTO/эндпоинты/UI/Martin — задачи
2.2+):

- **`@cuks/shared`**: GIS-enum'ы (`ADMIN_UNIT_LEVELS`, `INCIDENT_STATUSES`/`SOURCES`, `INCIDENT_
  RESOURCE_KINDS`, `GIS_LAYER_KINDS`, `GIS_IMPORT_STATUSES`, `GEOMETRY_TYPES`, severity 1–5),
  константы `GIS_SRID=4326`, `INCIDENT_NUMBER_PREFIX='ЧС'`.
- **Схема `gis`** (`schema/gis.ts`): `customType geometry(<Type>,4326)`; `admin_units` (дерево
  region→district→jamoat, code uq, MultiPolygon, population, GiST), `facilities` (Point),
  `risk_zones` (MultiPolygon, level 1–5), `layers` (slug **частичный uq по deleted_at**, kind),
  `layer_features` (Geometry). **Схема `app`** (`schema/incidents.ts`): `incidents` (number uq,
  type_code, severity 1–5, статус-машина, region/district/jamoat → admin_units, geom Geometry,
  жертвы int, damage_est **numeric(18,2)**, generated `russian search_tsv` GIN, GiST),
  `incident_reports`/`incident_resources` (cascade), `gis_imports`. Все enum-колонки — с DB-CHECK.
- **Миграция `0010`** (drizzle + хэнд-`CREATE EXTENSION postgis`) + **`0011`** (правки ревью).
  Применены: **PostGIS 3.5.2**, geometry_columns 4326, GiST/GIN на месте.
- **Классификатор ЧС** (`seed.ts`): полное дерево 2–3 уровней в `dictionaries` (`incident_type`,
  40 записей, стабильные коды `nat.geo.landslide`…), 0 осиротевших parent.
- **admin_units**: `seedGeo()` грузит 5 регионов Таджикистана из коммитнутого упрощённого GeoJSON
  (`data/tj-admin1.geojson`, geoBoundaries) через `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON,4326))`,
  идемпотентно; **`infra/scripts/seed-geo.sh`** — прод-импорт ADM1/2/3 через ogr2ogr со спатиальным
  parent-резолвом.

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные; `seed-geo.sh` синтаксис OK. **Live против
реального PostGIS 17-3.5**: миграции применяются; 40 записей классификатора; 5 регионов с валидной
геометрией (`ST_IsValid`) и площадями, совпадающими с реальностью (ГБАО ~62 765 км², Хатлон ~24 376
км²); **авто-определение региона по точке работает** (Душанбе→TJ-DU, Худжанд→Согд) — готовность к 2.5;
reseed идемпотентен.

**Adversarial-review** (воркфлоу: 3 измерения — schema-integrity, seed-and-geo, spec-conformance;
каждая находка рефутирована): **9 находок → 3 уникальных подтверждено** (после дедупа; 2 medium, 1
low), исправлены:

- **[medium]** `seed-geo.sh` затирал курируемые русские имена регионов английскими из geoBoundaries
  (`ON CONFLICT DO UPDATE SET name_ru=excluded`). Исправлено: русские имена регионов — встроенным
  маппингом по ISO-коду; при повторном импорте имена **сохраняются** (обновляется только geom);
  районы/джамоаты — латинский placeholder до русской локализации (задокументировано).
- **[medium]** `gis.layers.slug` — не-частичный unique: soft-delete «сжигал» slug навсегда (против
  конвенции репо). Исправлено: партиальный `unique … WHERE deleted_at IS NULL` (миграция 0011).
- **[low]** Нет DB-CHECK на `incidents.source`/`incident_resources.kind`/`gis_imports.status`
  (остальные enum-колонки — с check), а `gis_imports.status` инлайнил массив вместо
  `GIS_IMPORT_STATUSES`. Исправлено: 3 CHECK + использование shared-константы (важно — gis-схема
  прямо пишется QGIS-учётками).

**Рефутировано ревью (корректно)**: tg-имена = RU-placeholder (`onConflictDoNothing`) — задокументир.
конвенция (CLAUDE.md §4), правит админ; предполагаемый «code-collapse» ADM1 — release geoBoundaries
запинен, коды `TJ-XX` уникальны (проверено на реальных данных).

**Решения**:
- **Источник границ — geoBoundaries gbOpen (release `9469f09`, запинен)**: открытая лицензия,
  офлайн-воспроизводимо. Dev — 5 регионов (ADM1) из коммитнутого упрощённого GeoJSON; полный
  region→district→jamoat — прод-путь `seed-geo.sh` (ogr2ogr, нужен GDAL из worker-образа, здесь не
  прогонялся — как compose.prod/бэкап-скрипты).
- **Население регионов — приблизительные официальные цифры** (комментарий в сиде); точные —
  отдельным источником при полном импорте.
- **Классификатор — в существующей `dictionaries`** (`type='incident_type'`), не отдельная таблица
  (enum и дерево уже поддержаны 0.3).
- **Русские имена районов/джамоатов из geoBoundaries отсутствуют** (только Latin) — placeholder до
  локализации админом/справочником имён; регионы — курируемый русский маппинг.

### 2026-07-13 — Фаза 1: задача 1.9 (приёмочные e2e §9 + поток «новая версия») — закрывает фазу 1

**Сделано** (по `docs/modules/12` §9 — чеклист приёмки фазы 1):

- **Дореализован недостающий поток «загрузка того же имени → новая версия по подтверждению»**
  (§9 требует его; в UI его не было — вкладка «Версии» только листала + «сделать текущей»):
  `UploadTarget`/`uploadFile`/`enqueue` получили опциональный `targetNodeId` (шлётся в initiate →
  новая версия существующего узла); `FilesPage.startUpload` делит выбранные/дропнутые файлы на
  `fresh` (новые узлы, грузятся сразу) и `collisions` (имя совпало с файлом в текущем листинге) —
  коллизии открывают `ConfirmDialog` и по подтверждению грузятся как новые версии. i18n `versionUpload.*`
  (ru+tg, паритет 122/122).
- **Сид `seed-e2e.ts`**: рефактор в `provisionUser()`; добавлены `e2e_user` + `e2e_user2` (роль
  `employee`, не-суперадмины, без 2FA-гейта) — чтобы тест прав проверял реальный enforcement без
  bypass суперадмина. Креды в `fixtures.ts` (`E2E_USER`/`E2E_USER2`).
- **e2e `files-acceptance.spec.ts`** (+ хелпер `support/api.ts`: `apiLogin` через Playwright
  `request`-контекст, `csrfHeaders` из cookie): **3 теста** — **права** (владелец шарит personal-папку
  viewer другому: не-член `GET /files/:id` → 403 `access_denied`; viewer `POST /files/uploads` → 403
  `access_denied`); **версии** (загрузка → повтор именем → диалог → 2 версии в инспекторе → «сделать
  текущей» старую → появляется версия 3); **корзина** (загрузка → «В корзину» → подтверждение → узел
  ушёл → раздел «Корзина» → «Восстановить» → снова в «Мои файлы»).

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные. **Полный e2e-набор Playwright 10/10**
(3 новых приёмочных + login/create-user/assign-role/files). **Live против реального стека**: диалог
«новой версии» рендерится корректно, подтверждение создаёт вторую версию (`versionCount=2`, versions
`[2,1]`) — не дубль-узел. Тест-данные подчищены.

**Adversarial-review** (воркфлоу: 3 измерения — version-flow-correctness, e2e-assertion-integrity,
seed-and-permissions-soundness; каждая находка адверсариально рефутирована): **6 находок → 0
подтверждено, 6 рефутировано** (все — out-of-scope стиль/UX или safe-fail edge-cases без конкретного
дефекта). Ключевые рефутации: файл с именем существующей ПАПКИ обходит промпт версий → безопасный
серверный отказ `name_exists` (assertNoSibling кросс-kind — папка и файл с одним именем не сосуществуют);
client `toLowerCase` vs PG `lower()` на экзотическом Unicode → обе стороны fail-safe (сервер —
единственный авторитетный чек); тест viewer-403 проверял только статус → на самом деле ловит реальный
регресс (снятие editor-чека → 2xx → тест падает). **Сверх находок** (дешёвое усиление, хоть и
рефутировано): тест прав теперь проверяет и **код** ошибки (`files.node.access_denied`), а не только
статус 403 — чтобы падать только на реальном enforcement, а не на CSRF-403.

**Решения**:
- **EICAR/заражённый — не переигрывается в Playwright**: детект+блок+уведомление уже live-проверены в
  1.3 против реального ClamAV + юнит-тесты infected-ветки `getDownloadUrl`. ClamAV не имеет arm64-образа,
  а worker не входит в e2e-стек (Playwright поднимает только api+web) — Playwright-тест не получил бы
  вердикт. Пользовательское блокирование покрыто теми юнитами; дублировать через pg-инъекцию `infected`
  сочтено лишним связыванием e2e с БД.
- **Финальное удаление корзины по retention (§9 «фейк-время») — worker-юнит с фейк-временем из 1.3**
  (это worker-джоба, не Playwright).
- **Докачка файла 1.5 ГБ после обрыва сети (§9) — ручной тест + чанк-retry-юнит** (вне автоматического
  browser-e2e).
- **Поток версий: детекция коллизий клиентская (UX-оптимизация), enforcement — серверный**
  (assertNoSibling + assertAccess editor на targetNodeId); совпадение с именем ПАПКИ намеренно не
  предлагается как версия (папку нельзя версионировать) — сервер безопасно отклонит дубль.

### 2026-07-13 — Фаза 1: задача 1.8 (поиск файлов FTS + «Последние»)

**Сделано** (по `docs/modules/12` §2/§6/§7, `docs/07` §Поиск; PG FTS конфиг `russian`):

- **Схема/миграция `0009`**: generated tsvector-колонки + GIN — `fs_nodes.search_tsv`
  (`to_tsvector('russian', name)`) и `file_versions.extracted_tsv` (`to_tsvector('russian',
  coalesce(extracted_text,''))`). Обе STORED-generated → пересчитываются автоматически при
  rename/re-extract, без правок worker. Кастомный drizzle-тип `tsvector`.
- **`FileSearchService`**: `accessibleFilesCond(user)` — SQL-множество, **зеркалящее `hasAccess(
  viewer)`**: personal-владение ИЛИ узел/предок ∈ грантах (ACL для user/role/org_unit + активные
  link-гранты), развёрнутых в поддерево через префикс materialized-`path`. `search()` (FTS,
  ранжирование, `avStatus` из текущей версии, батч-крошки `location`), `recent()` (доступные файлы
  по `updated_at desc`).
- **Эндпоинты**: `GET /files/search?q&limit`, `GET /files/recent?limit` (объявлены до `:id`), под
  `files.use`, zod-валидация, Swagger.
- **Web**: раздел «Последние» в рельсе (иконка часов), поле поиска в тулбаре (debounce 300 мс),
  `ResultList` (открыть→просмотрщик, скачать, опц. расположение), i18n ru+tg (паритет 119/119).

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные (api 127, +4 юнита `FileSearchService`).
**Playwright** `files.spec.ts` 4/4 (+1: загрузка → поиск по имени → «Последние»). **Live против
реального стека (PG17+MinIO)**: имя с ru-нормализацией (`отчет`→`Отчёт…`, ё-folding+стемминг),
контент через `extracted_tsv` (`паводок`/`землетрясение` — нет в имени → hit), «Последние»,
**изоляция доступа** (второй юзер mirzoev.b **не видит** personal-файл nazarova ни в поиске, ни в
recent), нерелевантный запрос → 0. Тест-данные подчищены.

**Adversarial-review** (воркфлоу: 4 измерения — access-scope-security, fts-correctness-and-sql,
frontend-integration, api-and-dto; каждая находка адверсариально рефутирована): **5 находок → 3
подтверждено** (1 medium, 2 low), исправлены:

- **[medium]** FTS GIN-индексы **не использовались** — единый OR по трём источникам (`search_tsv`,
  join-`extracted_tsv`, `unnest(tags) ILIKE`) не покрывается ни одним индексом → seq scan (доказано
  `EXPLAIN` на PG17). Исправлено: `search()` перестроен на **UNION трёх индексируемых веток**
  (name-вектор → `fs_nodes_search_tsv_idx`, content-вектор → `file_versions_extracted_tsv_idx`,
  теги ILIKE — scope-bounded); фаза 2 гидратирует id с типизацией + `avStatus`, порядок по рангу.
  `accessibleFilesCond` не тронут — изоляция сохранена (проверено live: mirzoev → 0). `EXPLAIN`
  подтвердил `Bitmap Index Scan on fs_nodes_search_tsv_idx`.
- **[low]** Результаты поиска мигали полноэкранным скелетоном на каждое уточнение запроса.
  Исправлено: `placeholderData: keepPreviousData` в `useSearch` (прошлые хиты остаются видны).
- **[low]** Переключение раздела во время поиска ~300 мс показывало устаревшие результаты (`searching`
  выводился из debounced-значения). Исправлено: `searching` — из немедленного ввода (мгновенный
  выход), а debounced `q` — только для запроса; `searchPending`-гейт не даёт мигнуть «ничего не
  найдено» на входе.

**Рефутировано ревью (корректно)**: `location`-крошка «раскрывает» имена папок выше гранта viewer —
не новая утечка (идентично существующему `breadcrumbsFor`/`GET /files/:id`; файл легитимно доступен;
кросс-каттинг вопрос, не дефект 1.8); tag ILIKE без ё-нормализации/стемминга — задокументированный
компромисс (нет утечки/SQL-бага, только сниженный recall тегов).

**Решения**:
- **Теги — не в generated-векторе**: `array_to_string` в PG17 **STABLE** (не immutable) → нельзя в
  generated-колонке; `array_to_tsvector` immutable, но даёт сырые лексемы (без ru-нормализации) —
  бесполезно для русских тегов против нормализованного `websearch_to_tsquery`. Итог: `search_tsv` =
  только `name`; теги матчатся ILIKE-подстрокой (case-insensitive) отдельной UNION-веткой
  (scope-bounded скан — теги редкий и второстепенный путь).
- **`space=system` в скоуп не включается** (латентно, как и в 1.4): вложения модулей идут своим
  контуром; добавить `space in (personal,org)` при фазе модулей-вложений.
- **«Последние» = недавно изменённые (`updated_at`)** — отдельного per-user лога «открытий» нет
  (audit пишет только скачивания); достаточно и полезно, лог открытий — при необходимости позже.
- **Федеративный `/search` по всем модулям (`docs/07`) — вне 1.8** (модулей ещё нет); реализован
  `/files/search`.

### 2026-07-13 — Фаза 1: задача 1.7 (переиспользуемые FileDropzone/AttachmentList)

**Сделано** (по `ROADMAP.md` 1.7, `docs/modules/12` §3–4, `docs/06`; frontend-only, без изменений
API/миграций — обобщение уже проверенной логики загрузки, «не переписывая»):

- **`packages/ui` — презентационные примитивы** (locale-free, без api/`@cuks/shared` — чистота
  проверена grep'ом): `FileDropzone` (drag-drop + browse, клавиатурно-доступная кнопка, лейблы от
  потребителя), `AttachmentList`/`AttachmentRow` (список позиций с прогрессом/статусом/действиями,
  слоты `meta`/`subLabel`), `fileIcon(mime)` (единый mime→иконка — `files/lib.nodeIcon` теперь
  делегирует ему).
- **`apps/web/src/features/uploads` — общий feature-слой** (то, что зависит от api-client/react-
  query/i18n и не может жить в дизайн-системе): `uploadFile()` — единственный источник правды
  multipart-потока (sha256, XHR-части с прогрессом, ETag, complete→возвращает node DTO, abort при
  ошибке, опциональный `AbortSignal` для отмены); `useUploadStore` (глобальный док); `useUploadManager`
  (локальный менеджер поля — отдаёт готовые `FsNodeDto` вызывающему и отменяет незавершённую загрузку
  при удалении строки); `UploadDock` (переехал, рендерится через `AttachmentList`); `AttachmentField`
  (готовая композиция FileDropzone + менеджер + AttachmentList — drop-in для форм будущих модулей).
- **Общий `@/lib/format`** (`formatBytes`/`formatDateTime` вынесены сюда; `files/lib` ре-экспортит для
  обратной совместимости) — дизайн-система остаётся без локале-зависимых строк.
- **Рефактор `features/files`**: пустое состояние browsable-раздела теперь `FileDropzone` (действие
  вместо пассивного `EmptyState` — `docs/06` §UX); `FilesPage` тянет `UploadDock`/`useUploadStore` из
  `@/features/uploads`; удалены старые `features/files/api/uploads.ts` и `components/UploadDock.tsx`.
- **i18n**: новый namespace `uploads` (`locales/{ru,tg}/uploads.json`, tg — ru-заглушка, паритет
  ключей 11/11); строки дока переехали из `files.json`; добавлены `files:dropzone.*`.
- **Новых зависимостей нет.**

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные. **Компонентные тесты** `@cuks/ui` +10
(FileDropzone: drop/browse/multiple/disabled/**stopPropagation**; AttachmentList: рендер/действия/
**progressbar-a11y**). **Юнит** `@cuks/web` +3 (`useUploadManager`: захват узла, ошибка, отмена по
remove с abort сигнала). **Playwright** `files.spec.ts` 3/3 (селектор загрузки → `getByTestId(
files-file-input)`, т.к. в пустой папке теперь два `input[type=file]`). **Live против реального стека**
(nazarova.n): полный presigned-multipart через приложение — initiate `201` → PUT в MinIO `200`
(кросс-ориджин) → complete `201`; файл в списке, квота инвалидировалась, док прогресса рендерится через
`AttachmentList` в тёмной теме, просмотрщик открывается; **регресс двойной загрузки проверен** (один
drop на dropzone → ровно один initiate/complete/узел). Тест-данные подчищены.

**Adversarial-review** (воркфлоу: 4 независимых измерения — upload-flow-correctness, react-hooks-and-
state, reusable-component-api-and-a11y, integration-regression; каждая находка адверсариально
рефутирована): **7 находок → 2 подтверждено** (1 medium, 1 low), исправлены:

- **[medium, регресс]** Drag-drop на dropzone пустой папки грузил файл **дважды**: `FileDropzone.onDrop`
  делал `preventDefault`, но не `stopPropagation`, и drop всплывал до родительского `div onDrop` в
  `FilesPage` → `startUpload` срабатывал дважды (2 узла, 2× квота). Регресс введён заменой пассивного
  `EmptyState` на dropzone внутри drop-области. Исправлено: `FileDropzone.onDrop` останавливает
  всплытие (dropzone, обработавший drop, не должен повторно триггерить окружающую область);
  регресс-тест + live (один drop → один узел).
- **[low, a11y]** Строка `AttachmentList` в статусе загрузки передавала состояние только визуально
  (спиннер + `div` ширины) — без `role="progressbar"`/`aria-valuenow`, а `AttachmentField` ставил
  `meta`(процент) только после завершения → скринридер во время загрузки озвучивал лишь имя файла.
  Исправлено: полоса прогресса — `role="progressbar"` c `aria-valuenow/min/max` + опциональный
  `aria-label` (`labels.uploading`), декоративные иконки статуса `aria-hidden`; потребители передают
  лейбл.

**Рефутировано ревью (корректно)**: `useUploadManager` не отменяет загрузки при размонтировании — нет
потребителя (только barrel/тест), не регресс (старый док по спеке §4 переживает навигацию), спека не
требует abort-on-unmount; недоступные имена icon-кнопок (лейблы передаются потребителями); `FileDropzone`
без label+hint без имени (потребители всегда передают label); a11y-baseline дока; `AttachmentField`
`onChange([])` один раз на маунте (безвредно).

**Решения**:
- **Граница ui↔web**: презентационные примитивы (FileDropzone/AttachmentList/fileIcon) — в `packages/ui`
  (locale-free, лейблы/иконки от потребителя, как `UserPicker`); обвязка (uploadFile/стор/менеджер/док/
  поле) — в новом общем `apps/web/features/uploads`, т.к. зависит от api-client/react-query/i18n.
  Будущие модули (документы/чат/задачи/ЧС) — тоже web-фичи, поэтому переиспользование на уровне web, не
  дизайн-системы.
- **`space=system` вложения отложены**: API **отклоняет** прямую загрузку в system-пространство
  (`fs-nodes.service` `system_space_unsupported`) — узлы-вложения создаёт сам модуль своей машинерией.
  `UploadTarget` намеренно `personal|org`; первый модуль-потребитель (фаза 2+) добавит свой
  attachment-эндпоинт и передаст цель в тот же `AttachmentField`. Пока `AttachmentField` покрыт
  компонентными тестами, живая привязка — с первым потребителем.
- **«Не переписывая»**: проверенный multipart-поток перенесён дословно в одну `uploadFile()`; и
  глобальный док-стор, и локальный `useUploadManager` делят её.
- **`formatBytes`/`formatDateTime` → `@/lib/format`** (дизайн-система не держит ru-RU-строки);
  `files/lib` ре-экспортит — существующие импорты не тронуты.

### 2026-07-13 — Фаза 1: задача 1.6 (просмотрщики файлов)

**Сделано** (по `docs/modules/12` §5, `docs/06`; frontend-only, без изменений API):

- **Полноэкранный оверлей быстрого просмотра** (`components/viewer/FileViewerOverlay`): двойной
  клик/Enter по файлу → оверлей; диспетч по mime; стрелки ←/→ по файлам списка; Esc; шапка со
  скачиванием и закрытием. Заражённые (`avStatus=infected`) — карточка «заблокировано».
- **Просмотрщики**: изображения (`<img>`), pdf.js (`PdfViewer`), видео/аудио (нативные `<video>/
  <audio controls>` с HTTP range из MinIO), текст (`<pre>`, диапазонный запрос), карточка-скачать
  для прочего (docx/xlsx).
- **pdf.js** (`pdfjs-dist@6`, воркер бандлится локально через Vite `?url` — без CDN): один
  credentialed fetch байтов → `getDocument({data})`; рельс миниатюр + основная область показывает
  **только текущую страницу** (память ограничена одним canvas независимо от числа страниц);
  навигация страниц кнопками/PageUp-Down/↑↓/кликом по миниатюре.
- **Архитектура доставки байтов (проверена live)**: presigned-direct — кросс-ориджин GET из MinIO
  читается с range-поддержкой (206), поэтому медиа играет через element `src`, а pdf.js/текст читают
  байты напрямую; прокси не нужен.
- **UI-компонент**: `SidePanel`/`Sheet` получили проп `modal` (по умолчанию `true` — админ-панели без
  изменений); инспектор файлов теперь `modal={false}` (peek без бэкдропа), иначе модальный бэкдроп
  перехватывал второй клик двойного клика.
- **Новая зависимость**: `pdfjs-dist@^6.1` — спека `docs/modules/12` §5 явно требует pdf.js; воркер
  (~1.25 МБ) бандлится в `dist/assets`, не с CDN.

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные. **Playwright smoke** (3 теста, +1: загрузка
текстового файла → открытие в оверлее → Esc). **Live** (в браузере против реального стека): лайтбокс
изображения (загрузился), текст (кириллица), pdf.js (миниатюры + основная страница, навигация
1/2→2/2, один main-canvas), стрелки, Esc; тёмная тема корректна. Тест-данные подчищены.

**Adversarial-review** (воркфлоу: 3 измерения — untrusted-content-security, resources-and-correctness,
shared-sheet-regression): **7 находок → 6 подтверждено** (2 medium, 4 low), исправлены:

- **[medium]** `TextViewer` читал весь файл через `r.text()` до применения 512-КиБ-лимита — большой
  .log/.json (до 2 ГиБ) OOM-ил вкладку. Исправлено: диапазонный запрос `Range: bytes=0-524287`
  (MinIO отдаёт 206) + `AbortController` на размонтирование.
- **[medium/low]** `PdfViewer` рендерил ВСЕ страницы full-res в основную колонку (2×N canvas) —
  большой PDF (сотни страниц) исчерпывал память вкладки. Исправлено: основная область показывает
  только текущую страницу (1 canvas); миниатюры-canvas ограничены `MAX_THUMB_CANVASES=80`, дальше —
  номерные кнопки.
- **[low]** `getPage` в `PdfPageCanvas` без try/catch → unhandled rejection при быстрой навигации
  (документ уничтожен на лету). Исправлено: обёрнут в try/catch.
- **[low]** Esc закрывал и оверлей, и инспектор под ним. Исправлено: открытие оверлея закрывает
  инспектор (`setSelected(null)`), так что Esc закрывает только верхний слой.
- **[low]** ←/→ перехватывались навигацией по файлам даже в видео/аудио, ломая перемотку.
  Исправлено: для video/audio ←/→ не перехватываются (нативная перемотка); файлы — по экранным
  стрелкам.

**Рефутировано ревью (корректно)**: дубликат находки про Esc (перекрыт фиксом); `modal`-проп не течёт
в DOM (деструктурируется из props); `rel=noopener` присутствует; pdf.js рендерит в canvas
(sandboxed), небезопасные опции не включены.

**Решения**:
- **pdf.js: основная область — только текущая страница** (не непрерывный скролл всех страниц):
  IntersectionObserver-ленивость не воспроизводилась в среде проверки, а eager-рендер всех страниц
  исчерпывал память; постраничный просмотр ограничивает память одним canvas и надёжен для любого
  размера документа.
- **Байты для просмотрщиков идут presigned-direct из MinIO** (не через API-прокси) — кросс-ориджин
  GET с range читаем (проверено), так что прокси лишний; медиа через element `src`, pdf/текст —
  fetch.
- **Подсветка синтаксиса txt/md/код отложена** (спека §5 упоминает) — требует тяжёлой зависимости-
  подсветчика; в 1.6 текст показывается моноширинным `<pre>` (читаемо, безопасно — экранируется React).

### 2026-07-13 — Фаза 1: задача 1.5 (UI файлов)

**Сделано** (по `docs/modules/12` §6, `docs/06` дизайн-система; feature `apps/web/src/features/files`
по образцу `admin`):

- **Экран `/app/files`** (`FilesPage`): левый рельс разделов (Мои файлы / Общие / Доступные мне /
  Корзина) с индикатором квоты; тулбар (Загрузить / Новая папка / переключатель таблица↔сетка);
  хлебные крошки; центральная **DataTable-таблица** (имя+иконка типа, размер, изменён) и **сетка**
  превью-плиток (изображения — из preview-эндпоинта 1.3); состояние раздела в URL (`?section&folder`)
  — у каждой папки свой URL. Все состояния: skeleton/empty(`EmptyState`)/error/403.
- **Инспектор** (`FileInspector`, `SidePanel`) с вкладками: детали (метаданные + превью + AV-бейдж),
  версии (список + «сделать текущей»), доступ (кнопка шаринга), активность (заглушка).
- **Диалоги**: `NewFolderDialog`, `MoveDialog` (drill-down по дереву папок), `ShareDialog` (живой
  поиск людей через directory-эндпоинт → уровень; текущие гранты с бейджем «унаследовано» + отзыв;
  внутренние ссылки — создать/копировать/отозвать), `RenameDialog`, `ConfirmDialog` на корзину.
- **dnd-загрузка** (`uploads.ts` — Zustand-стор): presigned-multipart напрямую в MinIO (sha256 на
  клиенте, XHR-PUT частей с прогрессом, чтение ETag, complete) + **глобальный док прогресса**
  (`UploadDock`), переживающий навигацию. Drag-n-drop файлов на область содержимого.
- **Backend**: минимальный `DirectoryModule` (`GET /v1/directory/users?q=`, `/v1/directory/org-units`)
  — только аутентификация, отдаёт лишь отображаемые имена (id/ФИО/логин), для пикеров шаринга и
  будущих модулей (чат/задачи/документы). `api-client` получил `put()` и `delete()`-с-телом.
- **i18n**: `locales/{ru,tg}/files.json` (tg — ru-текст как заглушка), namespace `files`
  зарегистрирован.

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные. **Playwright smoke** (2 теста: разделы
рендерятся + создание папки видно в списке; разделы «Доступные мне»/«Корзина» открываются). **Live**
(в браузере против реального стека): страница рендерится; создание папки работает end-to-end;
**загрузка через браузер работает целиком** — XHR-PUT в MinIO кросс-ориджин, ETag читается через CORS
(главный риск — подтверждён рабочим); тёмная тема корректна (легитимные токены). Скриншот двух тем —
инструмент скриншота в этой среде таймаутил; проверка вёрстки — через accessibility-дерево + computed
tokens. Тест-данные подчищены из dev-БД.

**Adversarial-review** (воркфлоу: 3 измерения — directory-endpoint-security, upload-flow-correctness,
ui-state-and-correctness): **13 находок → 6 подтверждено** (все medium/low), исправлены:

- **[medium]** `directory.searchUsers` фильтровал только `deletedAt`, но не `status='active'` —
  заблокированные пользователи попадали в пикер шаринга как валидная цель. Исправлено: добавлен
  `eq(users.status,'active')` (как в `org-units.service.ts`).
- **[medium]** sha256 считался над `file.arrayBuffer()` (весь файл в память) — для файлов у 2 ГиБ-лимита
  RangeError/OOM. Смягчено/задокументировано: WebCrypto не умеет потоковый digest, а сторонняя крипта
  запрещена (CLAUDE.md), поэтому буферизация неизбежна; для desktop-таргета в диапазоне спеки (≤1.5 ГБ)
  работает, у 2 ГиБ-кромки — known limitation (комментарий в коде + это решение).
- **[medium]** `MoveDialog`/`ShareDialog` не сбрасывали внутренний стейк (drill-down / уровень доступа)
  между открытиями — риск переместить/выдать не туда/не тот уровень. Исправлено: рендер с `key={id}`
  (ремоунт со свежим стейтом при каждом открытии, как `RenameDialog`).
- **[low]** Квота не инвалидировалась после загрузки (док обновлял только список) — бар показывал
  устаревшее значение. Исправлено: инвалидация всего `['files']`-ключа по завершении загрузки.
- **[low]** `cancelLabel={t('common:cancel')}` — ключ лежит под `actions.cancel`, показывался сырой
  ключ. Исправлено: `common:actions.cancel`.
- Дополнительно (сверх находок): при ошибке загрузки теперь вызывается `abort`-эндпоинт (не ждём
  24ч-sweep retention) — best-effort очистка staging-строки + S3-multipart.

**Рефутировано ревью (корректно)**: чтение ETag кросс-ориджин (проверено live — работает), «энумерация
директории любым аутентифицированным» (сознательный дизайн интранет-справочника — только имена),
LIKE-метасимволы в `q` (drizzle параметризует — не инъекция).

**Решения**:
- **`DirectoryModule` — только аутентификация, без спец-разрешения** — интранет-справочник имён (уровень
  оргструктуры), нужен всем коллаборативным модулям; отдаёт лишь id/ФИО/логин активных пользователей.
- **Просмотрщики (pdf.js/лайтбокс) — задача 1.6; глобальный поиск файлов — 1.8** — в 1.5 вкладка
  «превью» инспектора показывает картинку-превью или карточку-скачать; поиска в тулбаре пока нет.
- **`FileDropzone`/`AttachmentList` как переиспользуемые компоненты — задача 1.7**; в 1.5 логика
  загрузки живёт в feature-сторе `uploads.ts` + `UploadDock`, чтобы 1.7 её обобщила без переписывания.
- **Клиентский sha256 больших файлов держит файл в памяти** — ограничение WebCrypto-only (потокового
  digest нет, сторонняя крипта запрещена); адресуется при добавлении чанк-retry / в 1.7.

### 2026-07-13 — Фаза 1: задача 1.4 (ACL-шаринг, внутренние ссылки, «Доступные мне»)

**Сделано** (по `docs/modules/12` §1–3; переиспользованы `resource_acl`/`AclService`/`ScopeService`
из фазы 0.5; исследование + adversarial-review прогнаны воркфлоу):

- **Наследование доступа вниз по дереву** — ключевое: `AclService.checkNodeAccess(user, folderIds,
  fileId, minLevel)` (один запрос по всем предкам в `path` + сам узел). `FsNodesService.assertAccess`
  теперь честит грант на любом предке (раньше — только корень org); добавлен нетроусный `hasAccess()`.
  Шаринг папки реально даёт доступ к её содержимому.
- **`FileSharingService`** (`apps/api/src/modules/files`): `getAcl` (прямые + унаследованные гранты с
  резолвом имени субъекта), `grantAcl` (PUT, + уведомление `files.file.shared`), `revokeAcl`,
  `createLink`/`listLinks`/`revokeLink`, `acceptLink`, `listSharedWithMe`. Управление доступом
  (`assertManage`): суперадмин | владелец personal | `manager`-грант на узле/предке | (org-узел +
  `files.org.manage`, ограниченный по scope через `ScopeService`).
- **Внутренние ссылки** — `file_links` (токен `node:crypto`) + `file_link_grants` (кто принял).
  Доступ по ссылке проверяется **вживую** (join на `file_link_grants`+`file_links` с фильтром
  `expires_at > now`) — отзыв/истечение ссылки СРАЗУ убирают доступ (см. ревью-находку ниже).
- **`GET /files/shared`** — union ACL-грантов и активных link-грантов, минус свои personal-узлы и
  membership-корни подразделений, дедуп до верхнего узла.
- **Эндпоинты**: `GET /files/shared`, `GET/PUT/DELETE /files/:id/acl`, `GET/POST /files/:id/links`,
  `DELETE /files/:id/links/:linkId`, `POST /files/links/:token/accept`.
- **Retention (worker)**: `purgeOneNode` дочищает осиротевшие `resource_acl` узла (`file_links`/
  `file_link_grants` каскадятся по FK); добавлен `purgeExpiredLinks` (истёкшие ссылки → каскад грантов).
- **Схема**: миграции `0007` (`file_links`), `0008` (`file_link_grants`), обе FK `onDelete: cascade`
  на узел (retention purge не падает на FK — усвоен урок находки 1.3).

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные (api: 123 теста, +20 к 1.3; worker: 45).
**Live** (против реального стека): шаринг папки участнику → унаследованное скачивание файла внутри
(302); «Доступные мне» с дедупом; viewer не может переименовать/управлять доступом (403); посторонний
403; ссылка create→accept→viewer→скачивание; отзыв/истечение ссылки → 403 (после фиксов); `editor`
не может удалить, но может переименовать (403/200); межвладельческое перемещение отклонено. Тест-данные
подчищены из dev-БД.

**Adversarial-review** (воркфлоу: 3 измерения — access-control-escalation, links-and-idor,
shared-listing-and-data — каждая находка адверсариально рефутирована): **10 находок → 7 подтверждено**
(2 medium-dup high, остальные low/medium), 5 уникальных проблем исправлены:

- **[high]** `acceptLink` писал ПОСТОЯННЫЙ `resource_acl viewer`-грант → отзыв (`revokeLink` удалял
  только строку `file_links`) и истечение ссылки НЕ убирали доступ (ссылка с `expires_at` = вечный
  доступ). Исправлено: акцепт пишет `file_link_grants` (не ACL), доступ проверяется вживую с фильтром
  по `expires_at`; каскад по FK + `purgeExpiredLinks` убирают гранты. Отзыв/истечение теперь реально
  режут доступ (проверено live).
- **[medium]** Удаление (в корзину) требовало `editor`, а `docs/modules/12` §1 отдаёт удаление
  `manager` (`editor` = загрузка/версии/переименование). Шаринг `editor` внешнему пользователю
  позволял ему стереть всё поддерево. Исправлено: `remove()` требует `manager` (владелец personal и
  суперадмин по-прежнему проходят; переименование остаётся `editor`).
- **[medium]** `grantAcl` мог перезаписать защищённый auto-грант org-корня (`revokeAcl` его защищал,
  но `grant` через `onConflictDoUpdate` — нет): понизить `editor→viewer` (сломать доступ всего
  подразделения) или поднять `→manager` (эскалация). Исправлено: общий `isProtectedRootGrant` в обоих
  путях.
- **[low]** `assertManage` использовал плоский, нескоупленный `user.permissions.includes(
  'files.org.manage')` + членство → держатель разрешения, ограниченного подразделением A, но с
  должностью в B, мог управлять файлами B (кросс-юнит-эскалация). Исправлено: проверка через
  `ScopeService.getAccessibleOrgUnits` (учитывает scope роли + поддерево).
- **[low]** `move()` не обновлял `owner_user_id` → участник с `editor` на чужой personal-папке мог
  перенести её к себе (спрятать от владельца, продолжая жечь его квоту). Исправлено: симметричный
  `cross_owner_move_forbidden` для personal (как уже был `cross_org_move_forbidden` для org).

**Не исправлено (рефутировано ревью или сознательно отложено)**:
- **Sweep истёкших `file_links`** — ревью рефутировало как необязательное (спец §8 упоминает только
  корзину/temp-uploads), но добавлено всё равно (`purgeExpiredLinks`, дёшево + консистентно).
- **`space='system'`-узлы в `listSharedWithMe`/`hasAccess`** — латентно (сейчас нет пути создания
  system-узла или folder/file-ACL на нём; вложения модулей идут через свои поля/права, `docs/modules/12`
  §3). Отложено до фазы модулей-вложений; тогда добавить `space in (personal,org)` в enforcement.
- **Дубли `inherited`-записей в `getAcl`** при гранте на нескольких предках — рефутировано:
  enforcement берёт max независимо, а `inheritedFrom` в DTO специально показывает источник каждого
  гранта (спец §1 требует лишь бейдж «унаследовано»). UI-презентация, не дефект.

**Решения**:
- **Доступ по ссылке — не материализованный ACL, а живая проверка** (`file_link_grants`+`file_links`
  join): единственный способ сделать `expires_at` и отзыв ссылки реально работающими без колонки
  expiry в общей `resource_acl` (которую делят другие модули).
- **Уведомление о шаринге — только для субъекта-пользователя** (`user`); гранты на подразделение/роль
  не рассылаются каждому члену (веерная рассылка вне скоупа 1.4).
- **Управление доступом на org-узлах — через `ScopeService`, а не плоские permissions** — платформа
  уже возит корректный scope-примитив; плоский список был бы кросс-юнит-дырой.

### 2026-07-13 — Фаза 1: задача 1.3 (jobs: av-scan/preview/text-extract/retention)

**Сделано** (по `docs/modules/12` §5/§8, `docs/09` §2; исследование + adversarial-review
прогнаны воркфлоу):

- **`apps/worker`**: собственный `StorageModule`/`StorageService` (S3-клиент, без кросс-app импорта
  из `apps/api` — тот же приём, что БД/почта в 0.13/1.1). Очереди: `av-scan` (ClamAV INSTREAM-клиент
  собственной реализации — единственный поддерживаемый npm-пакет `clamdjs` не обновлялся с 2022,
  ниже порога устаревания `docs/02`; magic-byte MIME-снифф через `file-type`; реал-байтовые проверки
  опасного текстового контента — `content-sniff.ts` — SVG со скриптом/обработчиками событий и
  shell-скрипт-шебанг, ни то ни другое не завязано на клиентский Content-Type), `preview` (sharp →
  webp, 3 размера), `text-extract` (`pdf-parse`/`mammoth` → `file_versions.extracted_text`),
  `retention` (ежедневный `0 3 * * *`: очистка abandoned-uploads, permanent purge корзины >30 дн,
  реconcile зависших `avStatus=pending`).
- **`apps/api`**: `UploadsService.complete()` энкюит `av-scan` после коммита; `FsNodesService.
  getDownloadUrl`/новый `getPreviewUrl` блокируют `infected`-вердикт; `GET /files/:id/preview?size=`;
  `FileVersionsService.restoreAsNew()` сбрасывает `avStatus` в `pending` и переэнкюит скан
  (перегенерирует превью/text-extract для новой версии, а не доверяет историческому вердикту).
- **`packages/shared`**: ключи очередей, `PREVIEW_SIZES`/`DANGEROUS_MIME_TYPES`/
  `TRASH_RETENTION_DAYS`/`STALE_PENDING_SCAN_HOURS`/`JOB_PARSE_TIMEOUT_MS`, `FsNodeDto.avStatus`.

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные (worker: 45 тестов; api: 103, +21 к 1.2).
**Live** (против реального ClamAV+MinIO+PG): EICAR-загрузка → real ClamAV-вердикт `infected`,
скачивание заблокировано 403, уведомление создано; реальное изображение → 3 корректных webp-превью
(проверены побайтово — `file`-детекция размеров совпала); реальные PDF/DOCX → `extracted_text`
заполнен; корзина с искусственно состаренным `deleted_at` → retention удалил DB-строки и все 4
MinIO-объекта (оригинал + 3 превью), подтверждено прямым запросом к MinIO. Повторно после фиксов
ревью: SVG с `onload=` и лживым `Content-Type: image/png` → корректно заблокирован 403 (закрывает
finding #1/#2 живым тестом, не только юнитами).

**Adversarial-review** (воркфлоу: 4 независимых измерения — antivirus-security,
retention-data-integrity, pipeline-correctness, api-access-control — каждая находка адверсариально
рефутирована отдельным агентом): **17 находок → 17 подтверждено** (5 high, 7 medium, 5 low), все
исправлены:

- **[high]** SVG-скрипт-проверка была завязана на клиентский `mime`, а не реальные байты — лживый
  `Content-Type` полностью обходил её. Исправлено: `content-sniff.ts` детектит SVG по реальному
  содержимому (с учётом BOM/UTF-16), независимо от заявленного mime.
- **[high]** Даже для честно заявленных SVG эвристика ловила только буквальный `<script` в первых
  64 КиБ UTF-8 — обходилась через `onload=`/`javascript:`-векторы, паддинг за границу окна, UTF-16.
  Исправлено: расширенный паттерн (`<script`/`on*=`/`javascript:`), декодирование с учётом BOM,
  окно увеличено до 4 МиБ.
- **[high]** `purgeTrash()` не перепроверял актуальность узла под блокировкой — конкурентный
  `restore()` мог быть молча уничтожен подчистую попавшим в снэпшот sweep'ом. Исправлено:
  `SELECT...FOR UPDATE` + повторная проверка `deletedAt`/cutoff внутри транзакции, покрывающей и
  удаление версий/узла (закрывает и полу-очищенное состояние при падении посреди цикла).
- **[high]** `purgeTrash()` мог упасть на FK-violation (`file_uploads` restrict-ссылается на
  `fs_nodes`) и намертво заблокировать весь sweep навсегда на каждом следующем прогоне. Исправлено:
  `purgeAbandonedUploads()` теперь идёт первым (снимает типичный источник ссылки) + per-node
  try/catch — один проблемный узел больше не блокирует остальные.
- **[high]** `restoreAsNew()` не переэнкюил av-scan для новой версии — превью/text-extract (ключ —
  `versionId`) навсегда 404-ились для восстановленной версии. Исправлено (см. «Сделано»).
- **[medium]** Версия, застрявшая на `avStatus=pending` (сбой энкюминга, исчерпанные ретраи BullMQ,
  недоступный ClamAV) не имела пути восстановления — вечно оставалась скачиваемой без вердикта.
  Исправлено: `retention.reconcileStalePendingScans()` переэнкюит скан для версий старше
  `STALE_PENDING_SCAN_HOURS` (1 ч).
- **[medium]** `purgeAbandonedUploads()` вызывал `abortMultipartUpload` до захвата
  (`delete...returning`) стейджинг-строки — конкурентный `complete()` мог быть саботирован гонкой
  (аборт инвалидирует upload-id прямо во время легитимного завершения). Исправлено: захват — до
  аборта (тот же приём, что уже `complete()`/`abort()` в `uploads.service.ts`).
- **[medium]** `preview`/`text-extract`-консьюмеры не проверяли `avStatus` сами — гейт держался
  только дисциплиной вызывающего кода (единственный сегодняшний продюсер — `av-scan.processor`).
  Исправлено: явная проверка `avStatus==='clean'` в обоих консьюмерах (defense-in-depth).
- **[medium]** Извлечённый текст с embedded NUL-байтом (повреждённый PDF/DOCX) валил `UPDATE`
  (`invalid byte sequence for encoding UTF8: 0x00`) — все 3 попытки детерминированно проваливались,
  задача терялась без следа. Исправлено: санитайз C0-управляющих символов (кроме tab/LF/CR) перед
  записью.
- **[medium]** `getPreviewUrl` молча пропускал отсутствующую `file_versions`-строку (в отличие от
  `getDownloadUrl`), маскируя целостность БД под обычное «превью ещё не готово». Исправлено:
  зеркальный громкий `throw`.
- **[medium]** Нулевое тестовое покрытие `getPreviewUrl` и `infected`-ветки `getDownloadUrl`.
  Исправлено: 12 новых юнит-тестов в `fs-nodes.service.spec.ts`.
- **[low]** `DANGEROUS_MIME_TYPES` содержал `x-sh`/`x-bat` — недостижимые записи (`file-type` не
  умеет сниффать текстовые скрипты по магическим байтам), создающие ложное чувство защищённости.
  Исправлено: удалены + добавлена реальная шебанг-детекция (`#!`) в `content-sniff.ts`.
- **[low]** Усечение `extracted_text` до `MAX_EXTRACTED_TEXT_LENGTH` резало по UTF-16 code units —
  могло разбить суррогатную пару (эмодзи/астральные символы) ровно на границе, молча портя хвост
  в U+FFFD при UTF-8-кодировании. Исправлено: `truncateSafe()` — не режет суррогатную пару.
- **[low]** `notifyInfected()` не проверял supersede-статус (в отличие от clean-ветки чуть ниже) —
  находка по устаревшей, уже заменённой версии создавала алерт «файл заблокирован» без указания,
  что текущая видимая пользователю версия не затронута. Исправлено: аудит/уведомление всё равно
  создаются (полнота security-журнала), но с явной пометкой `superseded` в meta и другим текстом.
- **[low]** `sharp`/`pdf-parse`/`mammoth`-вызовы не имели тайм-аута (в отличие от явного 60с у
  ClamAV-сокета) — патологический файл мог зависнуть на неопределённое время. Исправлено:
  `withTimeout()` (worker-локальный — нужны Node-таймеры, которых нет в изоморфном `packages/shared`).
  на оба вызова, `JOB_PARSE_TIMEOUT_MS=60000`.

**Решения**:
- **`zip-bundle`-джоба (упомянута в `docs/modules/12` §8) не входит в 1.3** — собственный чеклист
  `ROADMAP.md` для 1.3 её не перечисляет; трактуется как сознательно отложенная, не пропущенная.
- **`avStatus` в `FsNodeDto` заполняется только там, где вызывающий код уже держит версию в руках**
  (upload-complete, version-restore) — полный джойн для `tree()`/`getOne()`/`listTrash()`
  (`fs-tree.service.ts`) отложен: цена (JOIN на каждый список) выше пользы на этой стадии (UI ещё
  не построен — фаза 1.5/1.6); поле в DTO уже есть, следующая задача может заполнить его без
  изменения контракта.
- **Заявленный `mime` не корректируется на сниффленный после скана** — фикс bypass-находки закрывает
  ровно проверку безопасности (SVG/shell детектятся по реальным байтам), но не меняет доверие к
  `mime` в остальном пайплайне (ветвление preview/text-extract и т.д.) — более широкое изменение
  «sniffed mime как источник истины» шире скоупа 1.3.
- **`reconcileStalePendingScans()` не ограничена числом попыток** — файл, который в принципе не
  может быть просканирован (например детерминированно превышает лимит потока clamd), будет
  переэнкюиться раз в день бесконечно. Осознанно: ограниченная стоимость ресурсов, не баг
  корректности, и строго лучше, чем не восстанавливаться вообще.
- **Config-переключатель «запретить скачивание `pending`-файлов для ДСП-контуров»** (`docs/09` §2)
  не реализован — классификации грифов ДСП в проекте пока не существует ни в одной фазе; блокирующим
  для приёмки 1.3 не считается.

**Сделано** (по `docs/modules/12` §2-4, `docs/09` §2; org_units-паттерн и `AclService` из 0.5/0.6
переиспользованы напрямую; исследование + adversarial-review прогнаны воркфлоу):

- **Схема** (`packages/db/src/schema/fs.ts`, миграция `0006`): `fs_nodes` (materialized `path` как у
  `org_units`, `kind`/`space`-чеки, партиальный уникальный индекс «максимум один авто-корень на
  подразделение»), `file_versions` (уникальность `(node_id,version)`), `file_uploads` — staging-таблица
  между `StorageService`-сессией (1.1) и реальной записью fs_nodes/file_versions на `/complete`
  (`expires_at` для будущей retention-очистки 1.3, «temp-uploads 24 ч»). `users.quota_bytes` и
  `org_units.quota_bytes` (nullable) добавлены к существующим таблицам.
- **`apps/api/src/modules/files`**: `FsNodesService` (дерево-хелперы, `assertAccess`, квоты),
  `FsTreeService` (листинг/крошки, создание папок, `move()` — курсор org_units: advisory-lock +
  cycle-guard + пересчёт path потомков в транзакции, корзина с каскадом, restore), `UploadsService`
  (initiate/complete/abort поверх `StorageService` из 1.1), `FileVersionsService` (список версий,
  `restoreAsNew` — «сделать текущей = новая версия-копия», без физического копирования в MinIO —
  новая строка версии на тот же `storage_key`). Контроллер `/api/v1/files/*` под `@RequirePermission
  ('files.use')`.
- **Модель доступа (сознательно упрощена для 1.2)**: личное пространство — владение; общее
  пространство — ACL-проверка (`AclService.check`, существует с 0.5) на авто-провижинящийся корень
  подразделения (`ensureOrgRoot`), которому выдаётся `editor`-грант для `subject_type=org_unit` —
  никакой новой ACL-машинерии, только переиспользование. Эндпоинты выдачи/отзыва точечных грантов —
  задача 1.4; `assertAccess` уже сейчас падает через к прямой ACL-проверке узла, так что 1.4 не
  потребует правок в 1.2.

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные (api +26 тестов: `FsNodesService`
юнит на мок-ACL/мок-БД, `UploadsService` квота/владение, +1 на `StorageService.deleteObject`).
**Live** (два прогона против реального MinIO+PG, по образцу 1.1 — интеграционный харнесс для тест-БД
ещё не построен, известный `[P2]`): полный цикл (создание папки, дубликат-имя отклонён, реальный
multipart-аплоад, скачивание побайтово совпало, квота отразила загрузку, переименование, новая
версия файла, `restoreAsNew` создал 3-ю версию-копию, каскадные trash/restore, org-пространство —
авто-корень + ACL-допуск участнику + 403 постороннему) — все сценарии подтверждены дважды: до и
после фиксов ревью.

**Adversarial-review** (воркфлоу: 4 независимых измерения — access-control, data-integrity,
upload-flow-correctness, dto-and-api-surface — каждая находка адверсариально рефутирована отдельным
агентом): **17 находок → 17 подтверждено** (1 critical, 5 high, 5 medium, 6 low), все исправлены до
завершения задачи:

- **[critical]** Квота и лимит 2 ГиБ проверялись только по заявленному клиентом `size` на
  `initiate`; presigned part-URL не ограничивает Content-Length, так что клиент мог заявить
  `size:1` и залить сколько угодно байт. Исправлено: реальный размер из `storage.completeUpload()`
  теперь дополнительно проверяется на `complete()` (лимит + квота по факту, с поправкой на
  предыдущий размер при замене версии).
- **[high]** `move()` между двумя разными подразделениями общего пространства не пересчитывал
  `owner_org_unit_id` → «отмывание» квоты на чужое подразделение через простой PATCH. Исправлено:
  межподразделенческие перемещения запрещены (`files.node.cross_org_move_forbidden`) — перенос
  между подразделениями вне скоупа 1.2.
- **[high]** `ensureOrgRoot()` создавала запись + ACL-грант ДО проверки прав — любой держатель
  `files.use` (почти все роли) мог форс-провижинить корень и грант для чужого подразделения через
  обычный GET, до финального 403 (усиление записи + оракул по коду 404/403). Исправлено: авторизация
  (членство в подразделении или суперадмин) — до любой записи; insert+grant объединены в одну
  транзакцию (закрывает и соседнюю находку — сбой между двумя раздельными запросами навсегда
  блокировал подразделение без ACL с провалившимся созданием).
- **[high]** Любой рядовой участник подразделения (у всех — авто-`editor` на корне) мог удалить
  весь корень общего пространства одним `DELETE`. Исправлено: `files.node.root_not_deletable`.
- **[high]** `storage.completeUpload()` (необратимый внешний вызов, потребляет S3 upload-id) шёл до
  проверки существования/доступа к целевому узлу и до БД-транзакции — сбой транзакции (в т.ч. из-за
  гонки: целевой файл удалили, пока грузилась большая версия) оставлял осиротевший объект в MinIO и
  навсегда «зависшую» upload-сессию (повтор complete/abort бьёт по уже потреблённому upload-id).
  Исправлено: все проверки (существование, доступ, дубликат-имя, реальный размер/квота) — до
  вызова хранилища; staging-строка забирается атомарно (`DELETE...RETURNING`) прямо перед вызовом
  (закрывает и гонку двойного complete на один uploadId); при сбое после коммита в MinIO —
  `storage.deleteObject()` для очистки осиротевшего объекта.
- **[medium]** Restore каскадного trash перезаписывал `deleted_at` у потомков, уже удалённых
  независимо и раньше, тем самым «незапрошенно» возвращая их вместе с восстановлением предка.
  Исправлено: cascade-delete теперь исключает уже удалённых потомков (`isNull(deletedAt)`).
  **[medium]** Гонка номера версии (`SELECT max(version)+1` без блокировки) между
  `restoreAsNew`/`complete` — падало unique-индексом в сырой 500. Исправлено: `SELECT...FOR UPDATE`
  на узле перед вычислением следующей версии (в обоих местах). **[medium]** Массив `tags` не был
  ограничен по длине. Исправлено: max 50.
- **[low]** Проверка дубликата имени — только на `initiate`, не на `complete` (окно гонки — вся
  длительность загрузки, до 24 ч). Исправлено: повторная проверка на `complete()` (до вызова
  хранилища). **[low]** `complete()` не был идемпотентным (повтор после успеха бил по уже
  потреблённому uploadId, сырой 500) — закрыто той же атомарной `DELETE...RETURNING`-заявкой на
  стейджинг-строку. **[low]** `targetNodeId`-путь не перепроверял доступ на `complete()` (устаревшее
  разрешение при снятии с должности между initiate/complete — воспроизводимо уже сейчас через
  существующий `unassign`) — исправлено повторным `assertAccess`. **[low]** `completeUpload` был
  `@HttpCode(200)` вместо конвенционного 201-для-создания — исправлено (убран декоратор).
- **Не исправлено (сознательно, задокументировано в коде)**: единый глобальный `pg_advisory_xact_lock`
  на все перемещения + построчный (не батч) пересчёт path потомков — при очень большом поддереве
  надолго блокирует все чужие перемещения в системе. Попытка заменить на batch-UPDATE (`||
  substring(...)`) дала `null`-нарушение NOT NULL на path в live-проверке (причина не выяснена за
  разумное время) — откачено к проверенному построчному циклу; помечено как известное ограничение
  масштабирования, не блокирующее приёмку 1.2 (оргдеревья пока небольшие).

**Решения**:
- **`current_version_id` без FK на `file_versions`** — иначе цикл `fs_nodes ↔ file_versions`
  (тот же приём, что `org_units.head_position_id`).
- **Проверка дубликата имени — на уровне сервиса** (`SELECT` затем `INSERT`), не БД-constraint —
  малое окно гонки принято осознанно (упомянуто и во время ревью, не эскалировано выше low).
- **Размер папки не считается рекурсивно** — `size_cached` осмыслен только для `kind=file`;
  избегает бизнес-триггеров (запрещены `docs/04`) и рекурсивных апдейтов на каждый чих в поддереве.
- **`checksum_sha256` считается на клиенте** и отправляется на `/complete` — сервер никогда не видит
  сырые байты (presigned upload напрямую в MinIO), посчитать хэш на сервере значило бы скачивать файл
  обратно, убивая смысл прямой загрузки.
- **Публичные `/files/*`-эндпоинты 1.2 не включают ACL-шаринг** (`GET/PUT /files/:id/acl`, `POST
  /files/:id/links`, «Доступные мне») — задача 1.4; `assertAccess` уже готов принять точечные гранты
  без изменений.

### 2026-07-13 — Фаза 1: задача 1.1 (MinIO-сервис)

**Сделано** (по `docs/modules/12` §4, `docs/09` §2, `docs/02` ADR-6; спеки + `common/{redis,mail}`
прочитаны перед кодом):

- **Новая зависимость**: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — S3-клиент для
  MinIO, зафиксирован в `docs/02-stack.md` как выбор стека; версии/размер — см. «Добавленные
  зависимости» ниже.
- **`apps/api/src/common/storage`**: `StorageModule` (Global, по образцу `RedisModule`/
  `MailModule`) + `StorageService` — S3-клиент (`forcePathStyle: true` для MinIO), провижининг
  бакета на старте (идемпотентно, по образцу `ensure_audit_log_partition`), presigned-multipart
  жизненный цикл (`initiateUpload` → `getUploadPartUrl` ×N → `completeUpload`/`abortUpload`),
  presigned-скачивание с принудительным `Content-Disposition: attachment` (docs/09 §2: «прямой
  листинг бакетов закрыт») и RFC 5987 `filename*` для кириллических имён. Лимит 2 ГиБ (docs/09 §2)
  проверяется на `initiateUpload` до вызова S3 (`files.upload.too_large`, 400).
- Константы (`@cuks/shared/constants`): `MAX_FILE_SIZE_BYTES` (2 ГиБ), `UPLOAD_PART_SIZE_BYTES`
  (16 МиБ, docs/modules/12 §4), `UPLOAD_PART_URL_EXPIRY_SECONDS` (1 ч), `DOWNLOAD_URL_EXPIRY_SECONDS`
  (5 мин, «→ 302 на presigned (5 мин)»).

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные (api +11 тестов: 8 `StorageService`
юнит на мок-S3-клиенте + 1 на устойчивость `StorageModule.onModuleInit` + 2 noUncheckedIndexedAccess
фикса). **Live** (по образцу проекта — автоматический live-инфра-тест не строится, см. «Решения»):
одноразовый скрипт против реального dev-MinIO — `ensureBucket()` ×2 идемпотентно, реальный
multipart-аплоад (part 5 МиБ + part с кириллицей), `completeUpload` вернул верный size/eTag,
скачанные байты **побайтово совпали** с загруженными, `Content-Disposition` содержит и ASCII-фолбэк,
и `filename*=UTF-8''...` для «Отчёт.bin», `abortUpload` — без ошибки. Отдельно — реальный boot api
(`pnpm --filter @cuks/api dev`) против живого MinIO: `/api/health/ready` → `minio: "up"`,
`StorageModule dependencies initialized` без ошибок (бакет уже существовал после live-скрипта).

**Найдены и исправлены 2 бага в процессе (пойманы до коммита, не попали в историю как баги):**

- **[critical]** Циклический импорт `storage.module.ts` ↔ `storage.service.ts` (модуль импортирует
  сервис-провайдер, сервис импортирует токен `S3` из модуля) ломал DI Nest'а — «Nest can't resolve
  dependencies of the StorageService». Исправлено: токен `S3` вынесен в отдельный `storage.tokens.ts`,
  оба файла импортируют из него, цикл разорван. Поймано прогоном `pnpm --filter @cuks/api test`
  сразу после написания модуля.
- **[critical]** `StorageModule.onModuleInit()` синхронно звал `ensureBucket()` без try/catch —
  недоступный на старте MinIO (медленный `docker compose up`, rolling restart) **валил весь боевой
  старт api**, а не только health-пробу (по аналогии с `pool.on('error')`-фиксом из ревью 0.1–0.2:
  инфраструктурный клиент не должен ронять процесс). Воспроизведено тем же прогоном:
  `health.e2e-spec.ts` намеренно поднимает `AppModule` на недостижимой инфре, чтобы проверить
  «недоступно» ветку — `StorageModule` там реально пытался достучаться до MinIO. Исправлено:
  `onModuleInit` теперь best-effort (лог ошибки, без throw) — bucket будет запровижинен позже при
  первом реальном вызове/переретрае. Regression-тест `storage.module.spec.ts`.

**Решения**:

- **Скоуп 1.1 = только storage-сервис**, без публичных `/files/*`-эндпоинтов из `docs/modules/12`
  §7 — те завязаны на `fs_nodes`/`file_versions` (задача 1.2), которых ещё нет; строить их сейчас
  означало бы сразу переписывать под реальный node/version. `StorageService` принимает произвольный
  `key: string` — схему ключей задаст 1.2. Причина: минимальная разумная интерпретация неоднозначного
  пункта роадмапа (CLAUDE.md §1).
- **Живой S3-раунд-трип не встроен в автоматический набор тестов** — по установленному в проекте
  паттерну (`health.e2e-spec.ts` намеренно бьёт по недостижимой инфре, чтобы `pnpm test` не требовал
  живых сервисов; известный техдолг `[P2]` из ревью 0.5 — «интеграционные тесты требуют тест-БД,
  вводятся с харнессом» — харнесс ещё не построен). Живая проверка — одноразовый скрипт (не
  закоммичен), задокументирован здесь текстом, как и в предыдущих сессиях фазы 0.
- **worker получит свой независимый S3-клиент в 1.3** (av-scan/preview/text-extract), а не импорт из
  `apps/api` — между `apps/*` импортов нет (docs/03), и это уже устоявшийся паттерн проекта (свой пул
  PG и nodemailer-транспорт у worker, решения 0.13).

### 2026-07-13 — Продолжение на новой машине: бутстрап окружения + демо-сиды (закрывают приёмку Фазы 0)

**Окружение** (первый запуск на этой машине — заметки на будущее, ничего из этого не в git кроме `infra/docker/compose.dev.local-override.yaml`):

- `corepack enable` не может писать шимы в `C:\Program Files\nodejs` без прав администратора
  на этой машине. Обходной путь: `pnpm`/`pnpm.cmd` в `C:\Users\aminj\bin` (уже первым в PATH)
  проксируют на `corepack pnpm` — та же закреплённая `9.15.0`, без админ-прав. Постоянное решение
  (по желанию) — один раз выполнить `corepack enable` из повышенного терминала.
- На этой машине уже работает Laragon со своими **postgres** (5432), **redis** (6379) и
  **mailpit** (1025) на `127.0.0.1` — они перехватывали `localhost`-соединения, предназначенные
  контейнерам (Windows отдаёт приоритет более специфичному loopback-биндингу над `0.0.0.0`
  контейнера). Вместо правки Laragon или общего `compose.dev.yaml` добавлен непрокоммиченный
  `infra/docker/compose.dev.local-override.yaml`, переносящий только хост-порты: postgres→5433,
  redis→6380, maildev SMTP→1026; `.env` (тоже локальный, в `.gitignore`) указывает на них. MinIO/
  ClamAV конфликтов не было.
- Node на машине — v24.16.0; `engines`/`packageManager` фиксируют `>=22 <23`. Всё отработало (только
  engine-warning от pnpm) — не блокирует, но стоит иметь в виду при следующем апгрейде `engines`.
- Гейт `typecheck && lint && test && build` — зелёный. `pnpm e2e` (после `playwright install
  chromium`) — 3/3 passed.

**Демо-сиды (закрывают приёмочный критерий Фазы 0 «двое сотрудников из сидов видят разный UI по
правам»)** — решение заказчика: делать сейчас, не откладывать (см. «Принятые решения»):

- `packages/db/src/seed.ts` — `seedDemoUsers()` под флагом `--demo` (`pnpm db:seed -- --demo` /
  `SEED_DEMO_PASSWORD`, по умолчанию `Demo!2026`). 20 пользователей, фиксированные id/username
  (идемпотентно, как `ORG_SKELETON`), распределены по всем 10 подразделениям сида и 6
  не-суперадмин ролям-шаблонам (`chief`/`duty_officer`/`clerk`/`gis_analyst`/`employee`/
  `platform_admin`) с должностями (`positions`/`user_positions`, `isPrimary`, `isHead` →
  `org_units.head_position_id` для глав подразделений). Назначения ролей скопированы на
  `org_unit_id` пользователя (демонстрирует scope-модель 0.5/0.6), кроме `platform_admin`
  (IT-роль — глобальная). `mustChangePassword: false` — сознательное отличие от реального
  онбординга (temp-пароль + форс-смена): демо-аккаунты должны логиниться сразу единым
  задокументированным паролем, без трения на 20 первых входов. 2FA-гейт для ролей с
  `admin.*`/`docflow.sign`/`gis.pg.access` **не ослаблен** — те демо-пользователи всё равно
  попадают на обязательный enrollment при первом входе, как и в проде. Демо-сид отказывается
  работать при `NODE_ENV=production` (пароль общеизвестен).
- **Live-проверка приёмочного критерия**: `nazarova.n` (employee, «Ведущий специалист», Центральный
  аппарат) — вход паролем без 2FA (не требуется для роли), профиль и должность отображаются
  корректно, раздела «Администрирование» в сайдбаре нет. `yusupov.f` (platform_admin, «Администратор
  платформы», та же орг-единица) — вход корректно **запирает** на обязательный TOTP-enrollment
  («Двухфакторная аутентификация обязательна для вашей роли»); после исправления бага TOTP-окна
  (ниже) enrollment пройден **с первой попытки**, и в сайдбаре появляется раздел «Администрирование»
  (Пользователи/Роли/Оргструктура/Аудит), которого нет у `nazarova.n`. Критерий приёмки Фазы 0
  (двое сотрудников — разный UI по правам) — **закрыт и подтверждён живьём для обоих аккаунтов**.
- Идемпотентность проверена (повторный `pnpm db:seed -- --demo` — без дублей: 20/20/20 строк в
  `positions`/`user_positions`, роли без дублей).

**[P1→исправлено] Найдены и исправлены 2 бага при live-проверке** (не связаны с демо-сидами,
существовали ранее; вне исходного скоупа задачи «демо-сиды», но заказчик подтвердил — чинить сразу):

1. `TotpService` (`apps/api/src/modules/auth/totp.service.ts`) вызывает
   `authenticator.verify()`/`checkDelta()` из `otplib` без опции `window` — используется
   библиотечный дефолт, который на установленной версии оказался **`window: 0`** (проверено
   изолированным тестом: код, сгенерированный на 30 секунд раньше, отклоняется с `window: 0` и
   принимается с `window: 1`). Нулевой допуск означает **отсутствие устойчивости к сетевой
   задержке/задержке ввода**: код валиден только в точности до конца текущего 30-секундного шага
   на сервере — реалистичный ввод кода человеком (открыть приложение-аутентификатор, считать 6
   цифр, ввести, отправить) регулярно займёт больше времени и попадёт в следующий шаг, дав
   `auth.totp.invalid_code` **на корректный код**. Затрагивает и `confirmTotp` (enrollment), и
   `verifyForLogin` (обычный логин с 2FA) — и обязательный 2FA для ролей `admin.*`/`docflow.sign`/
   `gis.pg.access`, и опциональный 2FA у любой роли. Воспроизведено live при попытке завершить
   enrollment `yusupov.f` — 3 подряд свежесгенерированных кода отклонены; изолированный тест
   `otplib` вне приложения подтвердил причину. **Исправлено**: `authenticator.options = { window:
   1 }` (стандартная RFC 6238 практика допуска ±1 шага, не ослабляет защиту — replay всё ещё
   исключён Redis-гвардом в `verifyForLogin`) — apps/api/src/modules/auth/totp.service.ts:12-16.
2. **Побочно найден при диагностике №1**: `ENCRYPTION_KEY=` (пустая строка, ровно то, что
   отгружено в `.env.example` и получается по умолчанию в dev) **не запускает фолбэк на
   `SESSION_SECRET`**, вопреки комментарию/тесту/решению в этом файле («ENCRYPTION_KEY
   опционален... при отсутствии выводится из SESSION_SECRET»). Причина: `env.ts:27` —
   `z.string().optional()` пропускает `''` как валидную строку (не `undefined`); `crypto.
   service.ts:19` — `config.get('ENCRYPTION_KEY') ?? config.get('SESSION_SECRET')` — `??`
   реагирует только на `null`/`undefined`, `''` эту проверку не проходит, и `secret` остаётся
   пустой строкой. В результате ключ для AES-256-GCM шифрования TOTP-секретов в БД
   **детерминированно выводится из пустой строки** (публично известной константы) в любом
   dev/staging-окружении, оставленном с дефолтным `ENCRYPTION_KEY=` — контроль «зашифровано в
   состоянии покоя» из docs/09 фактически не защищает данные там. Подтверждено напрямую:
   расшифровка сохранённого `totp_secret` ключом от `SESSION_SECRET` падает (`Unsupported state
   or unable to authenticate data`), ключом от пустой строки — успешна. **В production не
   эксплуатируется** — там `env.ts:49` требует `ENCRYPTION_KEY` ≥32 символов на старте (fail-fast),
   так что уязвимо только dev/staging без явно заданного ключа. Юнит-тест `crypto.service.spec.ts`
   не поймал баг, потому что мокает `ENCRYPTION_KEY` как `undefined`, а не `''` (реальное значение
   из `.env`). **Исправлено на границе схемы**: новый хелпер `optionalString()` в `env.ts`
   транслирует `''→undefined` для всех 10 опциональных строковых переменных (не только
   `ENCRYPTION_KEY` — тот же класс бага грозил `TRUST_PROXY`/`SMTP_URL`/LiveKit/GeoServer/Martin/
   CA-переменным при их будущем использовании через `??`), плюс регресс-тест `env.spec.ts` (3
   теста: blank→undefined, реальное значение сохраняется, prod всё равно требует ≥32 симв.).
   Побочный эффект после фикса: у `yusupov.f` уже лежал pending TOTP-секрет, зашифрованный старым
   (пустым) ключом — новый `setupTotp()`-вызов не смог его расшифровать правильным ключом (500).
   Это ожидаемо при смене ключа шифрования (не отдельный баг) — исправлено вручную для одной
   dev-записи (`totp_secret = null`, эквивалент админского `reset-totp`); сама демо-фикстура не
   пострадала. — apps/api/src/config/env.ts, apps/api/src/common/crypto/crypto.service.ts:19.

**Тесты/проверка**: `typecheck/lint/test/build` — зелёные (полный монорепо-гейт прогнан трижды:
после демо-сидов, после фиксов). `apps/api` +4 теста (env.spec.ts ×3, plus существующий crypto-suite
не менялся). Live e2e-проверка приёмки — см. выше, включая полный успешный TOTP-enrollment
`yusupov.f` первой попыткой после фикса окна.

### 2026-07-13 — Фаза 0: задача 0.14 (Playwright smoke) — закрывает фазу 0

**Сделано** (заменил заглушку-smoke реальным e2e; исследование + adversarial-review прогнаны воркфлоу):

- **Каркас**: `apps/web/playwright.config.ts` — проекты `login` (без сессии) и `authed` (общий
  storageState); `webServer` поднимает api + web dev-серверы; `globalSetup` через реальный UI
  логинит e2e-админа и **проходит enrollment 2FA** (страница enroll показывает base32-секрет в
  `<code>`), сохраняя аутентифицированный storageState + секрет. Три smoke-теста: **логин** (полный
  двухшаговый пароль+2FA), **создание пользователя** (temp-пароль показан), **назначение роли**.
- **Фикстура БД**: `packages/db/src/seed-e2e.ts` (+ `seed:e2e`) провижинит `e2e_admin` с ролью
  **superadmin** — реальный назначающий роли (privilege-bounded delegation: не-суперадмин может выдать
  лишь подмножество своих прав, поэтому назначить операционную роль «Сотрудник» может только суперадмин)
  — и **сбрасывает 2FA/пароль/роли в чистый baseline на каждом прогоне**, поэтому suite детерминирован
  и повторно запускаем. Отказывается работать при `NODE_ENV=production`.
- **Детерминизм**: `freshTotp` **не переиспользует 30-секундный шаг** (переживает replay-guard логина
  при повторах Playwright); уникальные per-run логины (таймстемп в первом слове имени); storageState +
  секрет в `.gitignore`. Стабильные `data-testid` на auth/admin-экранах (`@cuks/ui` Button/Input теперь
  принимают `data-*`) — селекторы независимы от языка.
- **CI**: новый job `e2e` (postgres/redis-сервисы, build → migrate → seed → seed:e2e → playwright
  install → прогон; отчёт как artifact).

**Тесты/проверка**: `typecheck/lint/format/test/build` — зелёные. **Live**: полный прогон `pnpm e2e`
локально — **3/3 passed**, повторный прогон без ручного сброса — снова 3/3 (детерминизм подтверждён);
глобальный setup enrollment проходит; login-spec делает двухшаговый 2FA-вход.

**Adversarial-review** (воркфлоу 3 измерения → рефутация, 12 находок → 5 подтверждено, все исправлены):
(1) [med] replay-guard TOTP ломал повторы Playwright — `freshTotp` теперь всегда берёт свежий шаг;
(2) [med] seed-e2e плодил суперадмина с закоммиченным паролем без гарда — добавлен отказ при
`NODE_ENV=production`; (3) [low] `getByRole('textbox')` — хрупкий селектор — привязан к
`data-testid="users-search"`; (4) [low] прямой запуск без re-seed зависал — `global-setup` даёт понятную
ошибку; (5) [low] неуникальные логины-заглушки — таймстемп перенесён в первое слово имени.

**Решения**: (1) e2e-админ = **superadmin** (а не platform_admin): суперадмин — единственный, кто может
назначить операционную роль по правилу privilege-bounded delegation; last-superadmin guard касается
только revoke (тесты не делают), сид-`admin` — второй суперадмин. (2) Всё гоняется через UI (никакого
ручного CSRF в тестах). (3) `data-*` разрешён на Button/Input — легитимный хук для тестов/аналитики.

**Известные проблемы / приёмка фазы 0**: (а) критерий приёмки «двое сотрудников из сидов видят разный
UI по правам» **не покрыт** — демо-сиды (20 юзеров) — отдельная задача (`seed --demo` — заглушка);
сейчас в БД только `admin` (superadmin) и `e2e_admin`. Нужно решение заказчика: делать демо-сиды в
рамках приёмки фазы 0 или отложить. (б) e2e-тесты создают одноразовых юзеров, которые накапливаются в
dev-БД (в CI БД свежая каждый прогон) — очистка не делается намеренно (smoke). (в) CI e2e-job написан по
образцу рабочего локального прогона, но **на GitHub Actions не проверялся** (нет раннера здесь) —
проверить на первом PR.

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
- 2026-07-13 — **Демо-сиды делаются в рамках приёмки Фазы 0, не откладываются** — решение
  заказчика на явный вопрос («критерий приёмки "двое сотрудников — разный UI" не покрыт, делать
  сейчас или отложить?»): делать сейчас. Реализовано `seed.ts --demo` (20 пользователей/6 ролей/10
  подразделений), закрывает критерий (см. журнал сессии). CI e2e-job на реальном GitHub Actions —
  решено НЕ проверять отдельным PR сейчас, проверить естественным образом на первом реальном PR.

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
- [P1, исправлено 2026-07-13] `TotpService.verify()`/`checkDelta()` не задавали `window` для
  `otplib` → библиотечный дефолт `window: 0` (нулевой допуск шага) отклонял валидные TOTP-коды
  из-за обычной сетевой/пользовательской задержки (воспроизведено live). Затрагивало enrollment и
  логин с 2FA. Фикс: `authenticator.options = { window: 1 }`. —
  apps/api/src/modules/auth/totp.service.ts:12-16 (см. журнал сессии).
- [P1, исправлено 2026-07-13] `ENCRYPTION_KEY=''` (дефолт из `.env.example`) не подхватывал
  документированный фолбэк на `SESSION_SECRET` (`??` не реагирует на пустую строку) → TOTP-секреты
  в dev/staging шифровались ключом, выведенным из пустой строки (публичная константа) — контроль
  «encrypted at rest» не работал в дефолтной dev-конфигурации. Prod не был затронут (env.ts:49
  требует ключ ≥32 симв. на старте). Юнит-тест это не ловил (мокал `undefined`, не `''`). Фикс:
  `optionalString()` в `env.ts` нормализует `''→undefined` для всех 10 опциональных переменных +
  регресс-тест `env.spec.ts`. — apps/api/src/config/env.ts, apps/api/src/common/crypto/
  crypto.service.ts:19 (см. журнал сессии).

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
- `@aws-sdk/client-s3@^3.1085.0` + `@aws-sdk/s3-request-presigner@^3.1085.0` — S3-клиент для MinIO
  (docs/02 ADR-6, стек уже фиксирует «MinIO + AWS SDK v3»); модульные `@aws-sdk/*`-пакеты, без
  нативных биндингов. В `apps/api` (задача 1.1).
