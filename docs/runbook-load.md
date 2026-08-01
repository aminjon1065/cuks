# Нагрузочное тестирование и профилирование — runbook

Проверка, что платформа держит целевую нагрузку (docs/01 §sizing: до 500 пользователей, цель прогона —
**300 одновременных** пользователей API/WS), и профилирование медленных запросов (задача 7.4). Инструменты:
[k6](https://k6.io) для нагрузки, `pg_stat_statements` для профилирования БД.

## 1. Предпосылки

- **k6** установлен на машине-генераторе нагрузки (не на проде): `https://k6.io/docs/get-started/installation/`.
- **Пользователи для нагрузки** заведены и БЕЗ 2FA-гейта. Проще всего — сиды e2e (`pnpm db:seed:e2e`):
  `e2e_duty` / `E2eDuty!Passw0rd` (дежурный: gis.view, incidents, chat, analytics — как раз читаемые пути).
  Для реалистичного распределения сессий заведите несколько и передайте пул (см. ниже).
- **pg_stat_statements** включён (для профилирования): preload задан в `command` postgres в
  `compose.{dev,prod}.yaml`; расширение создаёт миграция `0045`. Если поднимаете на существующем кластере —
  перезапустите postgres (подхватить preload) и примените миграции:
  ```bash
  dc up -d postgres            # пересоздаст контейнер с новым command (том сохраняется)
  dc run --rm api pnpm db:migrate
  dc exec postgres psql -U cuks -d cuks -tAc "SHOW shared_preload_libraries;"   # -> pg_stat_statements
  ```

## 2. Прогон нагрузки

Скрипты в `infra/load/`. Основные переменные окружения: `CUKS_URL` (цель), `CUKS_USER`/`CUKS_PASS` или
`CUKS_USERS="u1:p1,u2:p2"` (пул), `VUS` (по умолчанию 300), `RAMP`/`HOLD` (длительности этапов).

```bash
# REST: 300 VU, read-mostly микс (сводка, ЧС, уведомления, чат)
k6 run -e CUKS_URL=https://<домен> -e CUKS_USER=e2e_duty -e CUKS_PASS='E2eDuty!Passw0rd' \
  infra/load/api-load.js

# Realtime: 300 Socket.IO-клиентов на namespace /ws, держат соединение и отвечают на ping
k6 run -e CUKS_URL=https://<домен> -e CUKS_USER=e2e_duty -e CUKS_PASS='E2eDuty!Passw0rd' \
  -e WS_HOLD_MS=60000 infra/load/ws-load.js

# Короткий smoke перед полным прогоном:
k6 run -e VUS=10 -e RAMP=10s -e HOLD=30s -e CUKS_URL=http://localhost:3000 infra/load/api-load.js
```

Скрипты логинятся **один раз на каждого пользователя пула** в `setup()` и переиспользуют cookie в 300 VU —
поэтому не упираются в лимит логина. WS-аутентификация — та же session-cookie в рукопожатии.

### СЭД: `infra/load/docflow-load.js`

Отдельный профиль на 200 VU (нефункциональный критерий СЭД — plan §14): реестр, поиск, карточка,
история, «требует внимания», сводка-отчёт **плюс** два конкурентных write-пути — регистрация в
журнале и запуск/прохождение маршрута. Читающая нагрузка без записи мимо главного: счётчик
регистрации — единственная точка сериализации в модуле, и очередь возникает именно на ней.

```bash
# Нужен пользователь с docflow.journals.manage (профиль создаёт свой журнал на прогон),
# docflow.create и docflow.reports.view. Проще всего — админ стенда.
k6 run -e CUKS_URL=https://<домен> -e CUKS_USER=<clerk> -e CUKS_PASS='...' \
  infra/load/docflow-load.js

# Доля итераций с записью (по умолчанию 0.15 — намеренно выше реального дня):
k6 run -e WRITE_SHARE=0.3 -e VUS=200 ... infra/load/docflow-load.js
```

Подготовка и уборка:

- **Объём.** Профиль отказывается стартовать, если пользователь не видит ни одного документа:
  измерять карточку на пустой базе бессмысленно. Тестовый объём — `pnpm --filter @cuks/db
  seed:perf:docs` (200 тыс. документов).
- **Журнал прогона.** `setup()` создаёт журнал `k6-<timestamp>` с `seqReset: never` — контention
  на счётчике настоящая, но живая нумерация не сдвигается.
- **Проверка нумерации после прогона** (главный смысл write-пути — уникальность и отсутствие дыр):
  ```sql
  SELECT count(*) AS total, count(DISTINCT reg_number) AS distinct_numbers,
         max(reg_number::int) AS max_seq
  FROM app.documents WHERE journal_id = '<id журнала k6>';
  -- total = distinct_numbers = max_seq  ⇒ дублей и дыр нет
  ```
- **Уборка.** Документы прогона помечены в теме префиксом `[k6 <timestamp>]`:
  ```sql
  UPDATE app.documents SET deleted_at = now()
  WHERE subject LIKE '[k6 %' AND deleted_at IS NULL;
  ```
  На стенде — да; на проде этот профиль не запускать, он пишет.

Пороги профиля — бюджеты из plan §14, по каждому эндпоинту отдельно (тег `name`):

| Путь | Порог p95 |
|---|---|
| `register-list`, `queue-counts` | < 500 мс |
| `card`, `card-history` | < 700 мс |
| `search`, `dashboard`, `attention` | < 1000 мс |
| `register-doc` (конкурентная регистрация) | < 2000 мс |

### Пороги (что значит «в норме»)

Заданы в скриптах как k6 thresholds (прогон падает, если нарушены):

| Метрика | Порог |
|---|---|
| `http_req_failed` | < 1% |
| `http_req_duration` p95 | < 800 мс (аналитика — < 1500 мс) |
| `ws_connecting` p95 | < 1000 мс |
| `ws_namespace_errors` | 0 (иначе — проблема авторизации /ws) |
| `checks` | > 99% |

### Про лимиты и авторизацию

- **Чтения (GET) не throttl-ятся** — `@Throttle` стоит только на auth-эндпоинтах, поэтому read-нагрузка идёт
  свободно.
- **Логин throttl-ится по IP** (`AUTH_LOGIN_RATE_PER_MINUTE`). При большом пуле пользователей пачка логинов в
  `setup()` с одного IP может упереться в лимит — держите пул небольшим или ослабьте лимит в нагрузочном
  окружении.
- **Блокировка (lockout)** считает только НЕудачные логины — с верными паролями не срабатывает.

## 3. Профилирование медленных запросов

```bash
# 1) Обнулить статистику перед прогоном
dc exec postgres psql -U cuks -d cuks -c 'SELECT pg_stat_statements_reset();'

# 2) Прогнать нагрузку (раздел 2)

# 3) Топ-25 запросов по суммарному времени
dc exec -T postgres psql -U cuks -d cuks -f - < infra/load/slow-queries.sql
```

Смотрите на `total_ms` (суммарный вклад), `mean_ms` (тяжесть одного вызова) и `calls`. Типовые действия по
верхним строкам: добавить индекс под фильтр/сортировку (миграцией), убрать N+1, ограничить выборку. После
правок — обнулить и прогнать снова, сравнить. Отчёт (пороги k6 + топ pg_stat_statements + принятые меры)
приложить к приёмке фазы 7.

## 4. Замечания

- Генерировать нагрузку с отдельной машины (иначе конкурируете с сервером за CPU).
- WebRTC-медиа (LiveKit) k6 не покрывает — ёмкость звонков проверяется отдельно по docs/modules/14 §9
  (ручной прогон с реальными участниками).
- Прод-цель по «железу» и запас — docs/08-deployment.md §Требования.
