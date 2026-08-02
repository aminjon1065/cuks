# СЭД: фоновые циклы — runbook

Три автоматических цикла модуля документооборота: **гейт предварительного ознакомления**,
**дедлайны резолюций** и **машинная отправка/приём (обмен)**. Здесь — где каждый живёт, как
понять, что он встал, и что делать. Спеки: `docs/modules/11-docflow.md` §5, §12.3, §12.12;
план — `docs/plan/sed_plan_implementation.md` этапы 6, 8, 10.

Общее правило: **ни один из циклов не хранит в Redis рабочее состояние.** Всё, что они делают,
восстанавливается из таблиц PostgreSQL, поэтому перезапуск процесса ничего не теряет и не
дублирует — предикаты UPDATE написаны так, что повторный проход безопасен. В Redis лежит только
одно — само расписание дедлайнов: repeatable job BullMQ (ключи `bull:deadlines:repeat:*`, §2).
Его worker перерегистрирует при каждом старте (`DeadlinesScheduler.onApplicationBootstrap`),
поэтому потеря Redis теряет не работу, а расписание до следующего подъёма worker'а.

§§4–7 — операторские процедуры того же модуля (этап 12): **счётчик регистрации**, **застрявший
маршрут**, **архивный legal hold** и **worker**. Там нет фоновых циклов, но есть состояния, в
которых работа встаёт, а само по себе ничего не чинится.

Ниже `dc` = `docker compose --env-file .env -f infra/docker/compose.prod.yaml`.

---

## 1. Гейт предварительного ознакомления

**Что делает.** Пакет ознакомления (`app.acquaintance_batches`) с `release_at` держит
поручения закрытыми, пока адресаты читают документ. Когда время вышло — гейт открывается сам,
исполнители получают свои поручения.

| | |
|---|---|
| Где выполняется | процесс **api**, `AcquaintanceGateService` (`onModuleInit` → `setInterval`) |
| Период | 60 с (константа `SWEEP_INTERVAL_MS`, гейт — часы, минута задержки несущественна) |
| Таблица | `app.acquaintance_batches` (`release_at`, `released_at`) |
| Идемпотентность | `released_at is null` стоит в предикате UPDATE — несколько инстансов api открывают гейт ровно один раз |

**Почему в api, а не в worker.** Логика открытия и её гонка с последним «ознакомился» живёт в
`ResolutionProposalsService`. Копия в worker была бы вторая реализация того же инварианта.

### Диагностика

```sql
-- Просроченные гейты: должны быть пусты дольше минуты-двух.
SELECT id, document_id, release_at, now() - release_at AS overdue
FROM app.acquaintance_batches
WHERE released_at IS NULL AND release_at IS NOT NULL AND release_at <= now()
ORDER BY release_at LIMIT 50;
```

```bash
dc logs api --since 10m | grep -i "acquaintance gate"
# «acquaintance gates opened» — цикл работает;
# «acquaintance gate release failed»  — конкретный пакет застрял, остальные идут дальше;
# «acquaintance gate sweep failed»    — упал весь проход (обычно БД).
```

### Что делать

- **Список из запроса не пустеет, в логах тихо** → цикл не запущен: api не поднялся или
  `onModuleInit` не отработал. `dc restart api`, затем проверить, что список тает.
- **Один пакет пишет `release failed` каждую минуту** → остальные не блокируются. Смотреть
  трассу в логе: обычно исполнитель/резолюция удалены. Ручное открытие — снять гейт вручную,
  повторив **обе** записи, которые делает `releaseIfDue` (`resolution-proposals.service.ts`),
  а не только первую:
  ```sql
  BEGIN;
  -- Причина обязательна в паре с released_at. Код на просроченном гейте, где остались
  -- непрочитавшие, ставит 'timeout'; если непрочитавших нет — 'all_acknowledged'.
  UPDATE app.acquaintance_batches SET released_at = now(), released_reason = 'timeout'
  WHERE id = '<batch id>' AND released_at IS NULL;

  -- Непрочитавшие: 'expired' — «гейт открылся без этого читателя», не «ознакомился».
  UPDATE app.acquaintances SET status = 'expired'
  WHERE batch_id = '<batch id>' AND status = 'pending';
  COMMIT;
  ```
  Чего этим UPDATE не сделать:
  - **поручения не разошлются** — рассылку делает отдельный вызов `notifyExecutorsForBatch`
    из sweep'а; предупредить исполнителей отдельно;
  - **в аудит не попадёт** `docflow.acquaintance.released` — зафиксировать причину вручную.

  И два предупреждения. `released_reason` нельзя оставить NULL: карточка показывает NULL как
  «Открыто: все ознакомились» (`ProposalsSection.tsx` подставляет `all_acknowledged` при null),
  то есть подписной лист соврёт. Значение `manual` из перечня не использовать — перевода для
  него в интерфейсе нет. И после ручного открытия sweep к пакету больше не вернётся
  (`released_at` уже не null), так что недоделанное автоматом не исправится.

  Завести дефект: ручное открытие гейта не должно требоваться.
- **Разовый прогон без ожидания минуты** — только перезапуском api (эндпоинта нет намеренно:
  ручной триггер гейта — это способ открыть чужое ознакомление досрочно).

---

## 2. Дедлайны резолюций и эскалация

**Что делает.** Ежедневный проход по контрольным активным резолюциям с датой: напоминание
исполнителю за 3 / 1 / 0 дней, ежедневное «просрочено» исполнителю и автору, а после 5 дней
просрочки — эскалация руководителю подразделения исполнителя.

| | |
|---|---|
| Где выполняется | процесс **worker**, очередь BullMQ `deadlines`, `DeadlinesProcessor` |
| Расписание | repeatable job `sweep`, `0 8 * * *`, tz `Asia/Dushanbe` |
| Куда пишет | `app.notification_outbox`, topic `docflow.deadline` (рассылает диспетчер в api) |
| Идемпотентность | dedupe-ключ `docflow.deadline:<resolutionId>:<tier>:<день>` — повторный прогон в тот же день ничего не задвоит |

Календарь — **Asia/Dushanbe**: «за 1 день» считается по местным суткам, а не по UTC. Это тот же
календарь, по которому нумеруются регистрации.

### Диагностика

```bash
# Есть ли repeatable job вообще (worker регистрирует его при старте):
dc exec redis redis-cli --scan --pattern 'bull:deadlines:repeat:*' | head

# Прогон за сегодня:
dc logs worker --since 24h | grep -i deadline
```

```sql
-- Сколько уведомлений о дедлайнах создано за сутки
-- (0 при наличии просроченных КОНТРОЛЬНЫХ резолюций — сигнал).
SELECT count(*) FROM app.notification_outbox
WHERE topic = 'docflow.deadline' AND created_at > now() - interval '1 day';

-- Что вообще должно было попасть в проход. Ровно выборка процессора: только контрольные
-- (`is_control = true`) и только по неудалённым документам. У app.resolutions своего
-- deleted_at НЕТ — мягкое удаление резолюции идёт вместе с документом, отсюда джойн.
SELECT count(*) FROM app.resolutions r
JOIN app.documents d ON d.id = r.document_id AND d.deleted_at IS NULL
WHERE r.is_control = true AND r.status = 'active' AND r.due_date IS NOT NULL;
```

### Что делать

- **Проход не случился (08:00 прошло, записей нет)** → worker лежал в этот момент. Repeatable
  job пропущенный слот **не догоняет**, и отдельного эндпоинта «прогнать сейчас» нет.
  Дедупликация по дню делает повторный прогон полностью безопасным (за тот же день ничего не
  задвоится), поэтому вариантов два: дождаться следующих 08:00 или добавить разовую job в
  очередь `deadlines` тем же именем `sweep` (одноразовый скрипт на `bullmq` с тем же
  `REDIS_URL`). Правкой ключей в redis-cli этого не сделать — формат внутренний.
- **Уведомления создаются, но не приходят** → проблема не здесь, а в диспетчере outbox
  (`DocflowDeadlineOutboxService` внутри процесса api, опрос раз в 5 с — §7): строки в
  `app.notification_outbox` остаются с `processed_at is null`.
- **Эскалация не уходит руководителю** → у исполнителя не заполнена должность/подразделение
  или у подразделения нет руководителя: процессор джойнит `positions` → `user_positions`, и без
  этой цепочки эскалировать некому. Это данные, а не цикл.

---

## 3. Машинный обмен: отправка и приём

**Что делает.** Отправка зарегистрированных исходящих через адаптер канала и приём входящих в
карантин. Строка `app.document_dispatches` **сама и есть** outbox: pending-попытка с
`next_attempt_at <= now()` — это «что осталось отправить».

| | |
|---|---|
| Где выполняется | процесс **api**: `ExchangeSenderService` и `ExchangeReceiverService` |
| Период | `DOCFLOW_EXCHANGE_POLL_SECONDS` (по умолчанию 60 с) |
| Включается | только если сконфигурирован хотя бы один адаптер (`DOCFLOW_EXCHANGE_DIR` и т.п.); иначе оба цикла не стартуют |
| Бюджет попыток | `DOCFLOW_EXCHANGE_MAX_ATTEMPTS` (по умолчанию 5) |
| Backoff | 30 с → 1 м → 2 м → 4 м … потолок 30 минут |
| Захват работы | `FOR UPDATE SKIP LOCKED`, claim коммитится **до** вызова адаптера — падение процесса не отправит письмо дважды. Цена — попытка, застрявшая на `pending` + `next_attempt_at IS NULL`, если процесс упал уже после claim (счётчик `in_flight` в диагностике) |

Непереотправляемая ошибка (`retryable: false`) уходит в dead-letter **сразу**, не тратя бюджет:
отказ по адресу не станет правильным от пяти повторов.

### Диагностика

```sql
-- Очередь отправки: что должно уйти прямо сейчас.
-- Два подвоха, поэтому фильтр по статусу стоит в каждом счётчике отдельно, а не в WHERE:
--   1) dead-letter пишется со статусом 'failed', а не 'pending'
--      (exchange-sender.service.ts: `status: deadLettered ? 'failed' : 'pending'`),
--      так что под общим `status = 'pending'` он всегда читался бы нулём;
--   2) захваченная попытка — это status = 'pending' И next_attempt_at IS NULL
--      (claim коммитится ДО вызова адаптера и обнуляет next_attempt_at). В норме такая
--      строка живёт секунды; застряла — значит процесс упал между claim и ответом адаптера.
SELECT count(*) FILTER (WHERE status = 'pending' AND next_attempt_at <= now()) AS due_now,
       count(*) FILTER (WHERE status = 'pending' AND next_attempt_at > now())  AS scheduled,
       count(*) FILTER (WHERE status = 'pending' AND next_attempt_at IS NULL)  AS in_flight,
       count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)                    AS dead_lettered
FROM app.document_dispatches
WHERE deleted_at IS NULL;

-- Разбор dead-letter: с чем именно оператор должен разобраться.
SELECT id, document_id, adapter_id, attempt_no, failure_code, failure_message, dead_lettered_at
FROM app.document_dispatches
WHERE dead_lettered_at IS NOT NULL
ORDER BY dead_lettered_at DESC LIMIT 50;

-- Карантин входящих: что ждёт разбора в «Обмен» (/app/docs/exchange).
SELECT status, count(*) FROM app.document_exchange_inbound GROUP BY status;
```

```bash
dc logs api --since 30m | grep -iE "exchange (send|receive)"
```

### Что делать

- **`due_now` растёт и не убывает** → цикл не идёт. Сначала — самая дешёвая проверка: при
  старте api `ExchangeRegistryService` пишет ровно одну строку из двух —
  `document exchange adapter «…» registered for <dir>` (адаптер есть) либо
  `document exchange is not configured; machine channels stay refused` (нет
  `DOCFLOW_EXCHANGE_DIR`; во втором случае `onModuleInit` обоих циклов выходит сразу и таймеры
  не создаются — это штатное состояние, а не поломка):
  ```bash
  dc logs api | grep -i "document exchange"
  ```
  Если адаптер зарегистрирован, а очередь стоит — `dc restart api`.
- **`in_flight` держится дольше нескольких минут** → попытка застряла между claim и ответом
  адаптера (падение процесса ровно в этом окне). Сама она не рассосётся: цикл её не переберёт
  (его предикат требует `next_attempt_at IS NOT NULL`), а оператор не повторит через API
  (`canOperatorRetry` пускает только `status = 'failed'`). Вернуть в очередь — вручную, убедившись
  по логам адаптера, что письмо **не** ушло (иначе получатель получит его дважды):
  ```sql
  UPDATE app.document_dispatches SET next_attempt_at = now(), updated_at = now()
  WHERE id = '<dispatch id>' AND status = 'pending' AND next_attempt_at IS NULL;
  ```
  и завести дефект: подбор «повисших» claim'ов должен делать сам цикл.
- **Dead-letter копится** → это не сбой цикла, а работа для оператора. Повтор — из карточки
  документа, «Отправка» → «Повторить»; API `POST /api/v1/docflow/dispatches/:id/actions/retry`
  открывает **новую** попытку с `retry_of` на старую. Повтор dead-letter разрешён намеренно:
  в этом и смысл списка. Руками в БД `dead_lettered_at` не снимать — лишится ссылка на разбор.
- **Входящие висят в карантине** → экран «Обмен» (`/app/docs/exchange`), права
  `docflow.register`. Заражённое вложение не даёт зарегистрировать сообщение — это тоже
  ожидаемо; такое сообщение отклоняют.
- **Одно и то же входящее пришло дважды** → не должно: дедупликация по
  `(adapter_id, external_id)` с `onConflictDoNothing`. Если продублировалось — адаптер выдал
  разные `external_id` на одно сообщение; это дефект адаптера, а не приёмника.

---

## 4. Счётчик регистрации

**Что делает.** Номер документа выдаёт `DocflowNumberingService.allocate()`
(`apps/api/src/modules/docflow/docflow-numbering.service.ts`) — одним оператором
`INSERT … ON CONFLICT (journal_id, year) DO UPDATE SET last_seq = last_seq + 1 … RETURNING`
по таблице `app.journal_counters`. Шаблон (`app.journals.number_template`) только форматирует
полученный `seq`; сам номер — это счётчик.

| | |
|---|---|
| Где выполняется | процесс **api**, внутри транзакции регистрации (`registerIncoming`, `register` в `documents.service.ts`) |
| Таблица | `app.journal_counters` (`journal_id`, `year`, `last_seq`, `updated_at`) |
| Сериализация | уникальный индекс `journal_counters_journal_year_uq` на `(journal_id, year)`: `ON CONFLICT DO UPDATE` берёт блокировку строки, и параллельные регистрации выстраиваются в очередь |
| Ведро года | `year` — год по календарю **Asia/Dushanbe** (`businessDateParts`), а не по UTC; для журнала с `seq_reset = 'never'` ведро всегда `year = 0` — одна сквозная книга |
| Откат | выделение идёт в транзакции вызывающего: если регистрация откатилась, откатился и инкремент — номер не «сгорает» |
| Бэкстоп | уникальный индекс `documents_journal_reg_number_uq` на `(journal_id, reg_number)` |

Комментарий в `packages/db/src/schema/docflow.ts` над `journalCounters` упоминает advisory-lock —
в коде его нет и искать его не нужно; сериализует уникальный индекс.

Дата регистрации — Asia/Dushanbe, поэтому документ, зарегистрированный 31 декабря после 19:00
UTC, попадает уже в следующий год и в следующее ведро счётчика.

### Диагностика

```sql
-- Текущее состояние счётчиков. year = 0 — сквозная книга (seq_reset = 'never').
SELECT j.code, j.name, j.doc_class, j.number_template, j.seq_reset,
       c.year, c.last_seq, c.updated_at
FROM app.journals j
LEFT JOIN app.journal_counters c ON c.journal_id = j.id
WHERE j.deleted_at IS NULL
ORDER BY j.code, c.year;
```

```sql
-- Сколько номеров реально выдано — по журналу и году регистрации (Asia/Dushanbe).
-- Мягко удалённые документы НЕ исключаются: номер за ними остался.
SELECT j.code,
       extract(year from d.reg_date AT TIME ZONE 'Asia/Dushanbe')::int AS year,
       count(*) AS issued
FROM app.documents d
JOIN app.journals j ON j.id = d.journal_id
WHERE d.reg_number IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;
```

```sql
-- Настоящий дубль (внутри журнала). Должно быть пусто: индекс его не пропускает.
SELECT journal_id, reg_number, count(*)
FROM app.documents
WHERE reg_number IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1;

-- Коллизия шаблонов: один и тот же текст номера в РАЗНЫХ журналах. Индекс это разрешает.
SELECT d.reg_number, count(DISTINCT d.journal_id) AS journals,
       array_agg(DISTINCT j.code) AS codes
FROM app.documents d
JOIN app.journals j ON j.id = d.journal_id
WHERE d.reg_number IS NOT NULL
GROUP BY d.reg_number HAVING count(DISTINCT d.journal_id) > 1;
```

### Что делать

- **«В системе два документа с одним номером»** → сначала различить два разных случая:
  - обе строки в **одном** журнале — это настоящий дубль, и он означает, что уникальный индекс
    отсутствует или был отключён; проверить `\d app.documents` и завести инцидент. Штатно такого
    не бывает;
  - строки в **разных** журналах — это коллизия шаблонов, а не сбой счётчика: `documents_journal_reg_number_uq`
    уникален в пределах журнала. Лечится разведением `number_template` (разные литеральные
    префиксы, например `{ВХ}-…` и `{ИСХ}-…`), а не правкой счётчика.
- **Счётчик отстал от уже выданных номеров** (типовая причина — восстановление БД из дампа, где
  `journal_counters` старее `documents`, или ручной `INSERT` документов) → **это срочно**:
  очередная регистрация получает уже занятый `seq`, падает на `documents_journal_reg_number_uq`
  (23505), транзакция откатывается — **а вместе с ней откатывается и инкремент счётчика**. Журнал
  заклинивает: каждая следующая попытка повторяет ту же ошибку, сам он из этого состояния не
  выйдет. Симптом у канцелярии — «регистрация не проходит вообще», у api в логе — unique violation
  по `documents_journal_reg_number_uq`.
  Поднять счётчик до максимума фактически выданного:
  ```sql
  -- 1) убедиться, какой seq уже занят (сверить глазами с number_template журнала):
  SELECT reg_number, reg_date FROM app.documents
  WHERE journal_id = '<journal id>' ORDER BY reg_date DESC LIMIT 20;

  -- 2) поднять (year — то же ведро, что в диагностике: год или 0).
  --    Именно INSERT … ON CONFLICT, а не голый UPDATE: строку счётчика создаёт лениво сама
  --    первая регистрация (`allocate`), и в типовом сценарии — восстановление из дампа —
  --    её может не быть вовсе. Голый UPDATE тогда молча ответит «UPDATE 0».
  INSERT INTO app.journal_counters (journal_id, year, last_seq)
  VALUES ('<journal id>', <ведро>, <максимальный выданный seq>)
  ON CONFLICT (journal_id, year)
  --    greatest() — потому что уменьшать счётчик нельзя никогда (см. предупреждение ниже).
  DO UPDATE SET last_seq = greatest(journal_counters.last_seq, excluded.last_seq),
                updated_at = now();
  ```
  После правки зарегистрировать один тестовый документ и убедиться, что номер идёт следующим.
- **Предупреждение: правка `last_seq` вручную — это способ выпустить дубль.** Уменьшать значение
  нельзя никогда: следующая регистрация выдаст номер, который уже стоит на бумаге. Если сомневаетесь
  в максимуме — округлите вверх: пропуск в нумерации неприятен, повторно выданный номер
  недопустим. Ни посмотреть, ни изменить счётчик через API нельзя — только SQL.
- **Перед новым годом проверить шаблоны.** Zod требует в `number_template` только токен `{seqN}`;
  журнал с `seq_reset = 'yearly'` и шаблоном без `{YYYY}`/`{YY}` в январе начнёт нумерацию заново и
  столкнётся с прошлогодними номерами того же журнала — то есть заклинит по сценарию выше. Проверяется
  первым запросом диагностики: `seq_reset = 'yearly'` при шаблоне без года.
- Смену `number_template` или `seq_reset` на живом журнале делать только между годами: счётчик при
  этом не пересчитывается, а ведро меняется (`year` → `0` и наоборот).

---

## 5. Застрявший маршрут

**Что делает.** Шаг маршрута (`app.route_steps`) в статусе `active` ждёт действия того, кого он
адресует. Пока шаг не закрыт, маршрут не движется, документ стоит в своём статусе, а автор ничего
сделать не может: состав уже запущенного маршрута не редактируется (шаги снимаются с шаблона в
момент старта).

| | |
|---|---|
| Где живёт | `app.routes` (`cycle`, `status`) + `app.route_steps` (`step_order`, `kind`, `status`, `assignee_type`, `assignee_id`) |
| Кто может закрыть | совпавший по назначению: сам пользователь (`user`), любой держатель должности (`position`), любой руководитель подразделения (`org_unit`, `positions.is_head`); плюс активный заместитель такого лица; плюс superadmin |
| Проверка при старте | `assertStepsHaveActors` — маршрут не стартует, если шаг никуда не разворачивается (`docflow.route.step_has_no_assignee`, 422). Для `org_unit` она мягче, чем проверка при закрытии: считает всех членов подразделения, а не только руководителей |
| SLA | `activated_at` + `due_hours` → материализованный `due_at`; напоминания — sweep worker'а, топик `docflow.route_deadline` |
| Принудительное закрытие | **нет.** В `routes.controller.ts` есть только `start`, `approve`, `complete`, `reject`, `validate` и CRUD шаблонов. Эндпоинта «закрыть за исполнителя», «переназначить шаг» или «отменить маршрут» не существует |

Проверка исполнителей делается **на каждый запрос**, а не запоминается на шаге: как только человек
появится на должности, шаг станет ему доступен без правки маршрута.

### Диагностика

```sql
-- Все активные шаги: кого ждём и сколько уже ждём.
SELECT d.reg_number, d.subject, r.cycle, s.id AS step_id, s.step_order, s.kind,
       s.assignee_type, s.assignee_id,
       coalesce(u.short_name, p.name, o.name) AS assignee,
       s.activated_at, s.due_at, now() - s.activated_at AS waiting
FROM app.route_steps s
JOIN app.routes r    ON r.id = s.route_id
JOIN app.documents d ON d.id = r.document_id
LEFT JOIN app.users     u ON s.assignee_type = 'user'     AND u.id = s.assignee_id
LEFT JOIN app.positions p ON s.assignee_type = 'position' AND p.id = s.assignee_id
LEFT JOIN app.org_units o ON s.assignee_type = 'org_unit' AND o.id = s.assignee_id
WHERE r.status = 'active' AND s.status = 'active' AND d.deleted_at IS NULL
ORDER BY s.activated_at;
```

```sql
-- Кто РЕАЛЬНО может закрыть шаг (только активные, не удалённые пользователи).
-- Пусто ⇒ шаг закрыть некому.

-- assignee_type = 'position':
SELECT u.id, u.short_name, u.status
FROM app.user_positions up
JOIN app.positions p ON p.id = up.position_id AND p.deleted_at IS NULL
JOIN app.users u ON u.id = up.user_id AND u.status = 'active' AND u.deleted_at IS NULL
WHERE p.id = '<assignee_id>';

-- assignee_type = 'org_unit' — то же, но по подразделению И ТОЛЬКО РУКОВОДИТЕЛИ:
SELECT u.id, u.short_name, u.status
FROM app.user_positions up
JOIN app.positions p ON p.id = up.position_id AND p.deleted_at IS NULL
JOIN app.users u ON u.id = up.user_id AND u.status = 'active' AND u.deleted_at IS NULL
WHERE p.org_unit_id = '<assignee_id>' AND p.is_head = true;

-- assignee_type = 'user'     — SELECT id, short_name, status FROM app.users
--                              WHERE id = '<assignee_id>' AND status = 'active' AND deleted_at IS NULL;
```

```sql
-- Действующие подстановки на этого принципала (кто может действовать «за» него).
SELECT s.id, pr.short_name AS principal, de.short_name AS deputy,
       s.scope, s.starts_at, s.ends_at, s.is_active
FROM app.substitutions s
JOIN app.users pr ON pr.id = s.principal_id
JOIN app.users de ON de.id = s.deputy_id
WHERE s.deleted_at IS NULL AND s.principal_id = '<user id>';
```

**Осторожно с шагом на подразделение.** Система здесь несимметрична, и это ловушка при разборе:
закрыть шаг `org_unit` может **только руководитель** подразделения (`actorAssignments` берёт
`positions.is_head`), а проверка при старте (`assertStepsHaveActors`) и `validate` считают
исполнителями **всех** сотрудников подразделения (`resolveAssigneeUsers`). Поэтому маршрут
спокойно стартует на подразделении из десяти человек без руководителя — и встаёт намертво:
широкий запрос вернёт десять строк, а закрыть шаг не сможет никто. Если разбираете шаг
`org_unit`, смотрите именно запрос с `is_head = true`; лечение — назначить руководителя
(`positions.is_head`), а не добавлять людей в подразделение.

**Dry-run проверки маршрута** — `POST /api/v1/docflow/documents/:id/route/validate`, право
`docflow.create`, тело такое же, как у старта (`templateId` **или** `steps`). Ответ: по каждому
шагу `assigneeName`, `actorNames` (для `user` и `position` — кто сможет действовать; для
`org_unit` — **все члены подразделения**, а не только руководители, см. оговорку выше)
и `problems` —
`no_assignee` (никого не нашлось) либо `assignee_not_found` (сам адресат не существует / удалён),
плюс `groups` — состав параллельных групп. Ничего не пишет.

Важно, чего он **не** делает: он проверяет **определение** маршрута (тело запроса или шаблон), а не
уже запущенный маршрут — `:id` в пути даже не читается. Чтобы проверить застрявший маршрут, либо
пользуйтесь SQL выше, либо подайте в validate те же шаги, что стоят в `route_steps`.

### Что делать

- **Должность вакантна / в подразделении нет руководителя** (запрос «кто реально может закрыть
  шаг» пуст) → назначить человека на должность (`app.user_positions`, экран администрирования
  оргструктуры), а для шага `org_unit` — убедиться, что у его должности стоит `positions.is_head`.
  Шаг станет доступен сразу, ничего в маршруте править не нужно. Это основной штатный ремонт.
- **Исполнитель уволен/заблокирован, шаг адресован лично ему (`assignee_type = 'user'`)** → штатное
  решение — **подстановка**: `POST /api/v1/docflow/substitutions` (`principalId` — выбывший,
  `deputyId` — кто действует, `startsAt`/`endsAt` — окно). Свою подстановку заводит сам принципал;
  чужую — держатель `admin.substitutions.manage`. Заместитель увидит шаг в своей очереди, а в
  `route_steps.acted_for` останется принципал, за которого он действовал (в аудите — ещё и
  `auth.substitution.used`). Статус самого принципала при этом не важен: действует заместитель.
  Оговорка: `activePrincipalsFor` не фильтрует `scope`, поэтому подстановка со `scope = 'docflow'`
  и `scope = 'all'` действует на маршруты одинаково.
- **Ни назначить, ни подставить нельзя** → остаётся отклонение: `POST /api/v1/docflow/route-steps/:id/actions/reject`
  (право `docflow.use`, причина обязательна). Маршрут переходит в `cancelled`, документ возвращается
  автору в `draft`, автор запускает новый маршрут — он пойдёт следующим `cycle`. Это и есть
  предусмотренный способ «переиграть» маршрут, потому что править состав активного маршрута нечем.
  Отклонить может только тот, кто и так назначен на шаг (или superadmin).
- **Superadmin действительно может закрыть любой активный шаг** — проверка назначения для него
  короткозамкнута. Но это не «админское закрытие»: действие запишется его именем, `acted_for`
  останется пустым, в аудите будет обычный `docflow.document.route_step_done`. Применять только
  когда назначение и подстановка невозможны, и фиксировать причину отдельно.
- **Назначенный жалуется на «документ не найден» (404 `docflow.document.not_found`)** → документ
  ДСП, а человек не в допуск-списке. Назначение на шаг и подстановка **не** заменяют допуск.
  Лечится добавлением в `access_list` тем, кто вправе управлять грифом, а не правкой маршрута.
- **Шаг активен, но кнопки закрыть его нет** — так и задумано для трёх видов:
  - `register` — закрывается самой регистрацией (документ при активации шага переводится в
    `pending_registration`). Здесь маршрут встаёт чаще всего, и причина видна по коду ошибки
    регистрации: `docflow.journal.inactive` (журнал закрыт — типовая январская история),
    `docflow.journal.class_mismatch` (журнал другого класса документов),
    `docflow.document.register_forbidden` (нет прав канцелярии);
  - `sign` — нужна настоящая подпись;
  - `acknowledge` — нужно, чтобы ознакомились все адресаты (лист разворачивается в людей).
- **Маршрут стоит, и никто не жалуется на просрочку** — нормальный симптом вакантного адресата:
  sweep пропускает шаг, если исполнителей не нашлось (уведомлять некого), поэтому напоминаний
  `docflow.route_deadline` по нему не будет вовсе. Их не будет и у шага без `due_hours` — тогда
  `due_at` пуст и SLA-часов у шага просто нет. Отсутствие жалоб не означает, что всё идёт.

---

## 6. Архивный legal hold

**Что делает.** Запрет на уничтожение стоит на самом документе и перевешивает любой срок хранения.
Пока он стоит, документ не помечается кандидатом, не попадает в акт и не может быть списан.

| | |
|---|---|
| Где живёт | `app.documents`: `legal_hold`, `legal_hold_reason`, `legal_hold_at`, `legal_hold_by` |
| Право | `docflow.archive.hold` — и поставить, и снять. Из шаблонов ролей оно есть только у `chief` (плюс superadmin); отдельной роли «архивариус» в системе нет |
| Эндпоинты | `POST /api/v1/docflow/documents/:id/actions/legal-hold`, `DELETE /api/v1/docflow/documents/:id/legal-hold` — оба требуют `reason` |
| Где проверяется | sweep worker'а (предикат `legal_hold = false`), включение документа в акт (`claimItems` → `assertDisposable`), исполнение акта (`executeBatch` → `assertDisposable`) |
| Аудит | `docflow.archive.legal_hold_set`, `docflow.archive.legal_hold_cleared` — обе записи с причиной |

Запрет — **не UI-флаг**: прямой вызов API на включение в акт или на исполнение акта получает 409
`docflow.archive.legal_hold`. Проверка стоит на каждом шаге отдельно, поэтому запрет, поставленный
уже после утверждения акта, всё равно останавливает исполнение.

### Диагностика

```sql
-- Что сейчас под запретом и почему.
SELECT d.reg_number, d.subject, d.case_index,
       d.legal_hold_reason, d.legal_hold_at, u.short_name AS held_by,
       d.retention_until, d.disposition_status
FROM app.documents d
LEFT JOIN app.users u ON u.id = d.legal_hold_by
WHERE d.legal_hold = true AND d.deleted_at IS NULL
ORDER BY d.legal_hold_at DESC;
```

```sql
-- Документы под запретом, попавшие в живой акт: именно они валят исполнение акта.
SELECT b.number AS act, b.status AS act_status, d.reg_number, d.legal_hold_reason
FROM app.archive_disposition_items i
JOIN app.archive_disposition_batches b ON b.id = i.batch_id AND b.deleted_at IS NULL
JOIN app.documents d ON d.id = i.document_id
WHERE d.legal_hold = true AND b.status IN ('draft', 'pending', 'approved');
```

```sql
-- История запретов по документу (кто ставил/снимал и с какой формулировкой).
SELECT created_at, action, actor_id, meta
FROM audit.audit_log
WHERE entity_type = 'document' AND entity_id = '<document id>'
  AND action IN ('docflow.archive.legal_hold_set', 'docflow.archive.legal_hold_cleared')
ORDER BY created_at;
```

В UI то же самое — экран «Архив» (`/app/docs/archive`), фильтр по запрету; выгрузка описи в XLSX
показывает причину в колонке «Запрет».

### Что делать

- **Исполнение акта падает с 409 `docflow.archive.legal_hold`** → один документ под запретом валит
  **весь** акт: `executeBatch` перечитывает политику по каждой позиции в одной транзакции, и первый
  отказ отменяет её целиком. Найти виновника вторым запросом диагностики.
- **Убрать один документ из акта нечем** — эндпоинта удаления позиций нет, а пополняется состав
  только пока акт — черновик (`POST …/items` отвечает 409 `docflow.disposition.not_draft` на любом
  другом статусе). То есть у поданного акта состав заморожен в обе стороны. Дальше всё зависит от
  того, в каком статусе акт застал запрет:
  - **акт ещё `pending`** (подан, но не утверждён) — вариантов два: снять запрет либо **отклонить
    акт** (`POST /api/v1/docflow/archive/disposition-batches/:id/actions/reject`). Документы
    вернутся в `disposition_status = 'none'`, а списание пойдёт **новым** актом: отклонённый акт
    повторно не подаётся (`submit` разрешён только из `draft`), то есть нужны новая сборка, новая
    подача и новое утверждение вторым человеком;
  - **акт уже `approved`** (а это и есть случай упавшего исполнения) — вариант остаётся **один**:
    снять запрет. Акт остаётся в статусе `approved` и исполняется обычным образом, повторного
    утверждения не требуется. Отклонить утверждённый акт **нельзя**: `reject` разрешён только из
    `pending` (`BATCH_TRANSITIONS` в `archive-policy.ts`), на `approved` он отвечает 409
    `docflow.disposition.invalid_transition`.

  **Если запрет должен остаться, а акт уже утверждён — штатного выхода нет.** Акт навсегда
  зависает в `approved`, а его документы — в `disposition_status = 'approved'`, из-за чего их
  ещё и нельзя вернуть из архива (409 `docflow.archive.in_disposition`) и нельзя внести в другой
  акт. Практический вывод: **проверять legal hold до утверждения акта** — вторым запросом
  диагностики, пока акт в `pending`, когда отклонение ещё возможно. Если ситуация всё же
  сложилась — эскалировать: разблокировать её можно только правкой в БД, а это отдельное решение
  с фиксацией причины, не операторская процедура.
- **Снятие запрета — тоже акт с причиной.** `DELETE …/legal-hold` требует `reason`, пишет
  `docflow.archive.legal_hold_cleared` и снимает запрет только если он стоял (иначе 409
  `docflow.archive.no_legal_hold`). Ближайшей ночью (sweep в 03:00) документ с истёкшим сроком и
  `disposition_status = 'none'` снова станет `candidate` — это ожидаемо. Постановка запрета, наоборот,
  сбрасывает `candidate` обратно в `none`, чтобы «кандидат» не стоял рядом с запретом.
- **Кто может поставить запрет.** Только `docflow.archive.hold`; шаблон роли с этим правом —
  `chief`. При этом пункт «Архив» в навигации показывается по `docflow.register`, которого у
  `chief` нет, — руководитель открывает экран по прямому адресу `/app/docs/archive` (сам маршрут
  правом не закрыт, а API пускает его по `docflow.control`). Это известная нестыковка UI и API,
  не сбой прав.
- **Руками в БД `legal_hold` не трогать.** Прямой `UPDATE` не пишет ни причину, ни автора, ни
  запись в аудит — получится запрет, который никто не может объяснить и, следовательно, снять
  обоснованно.

---

## 7. Worker: что он делает для СЭД

**Что делает.** Отдельный процесс (`apps/worker`), потребляющий очереди BullMQ из того же Redis,
что и api. HTTP-эндпоинта здоровья у него нет — «жив» определяется по очередям, логам и `dc ps`.

| Очередь (`packages/shared/src/queues/index.ts`) | Что делает для СЭД |
|---|---|
| `deadlines` | repeatable `sweep`, `0 8 * * *`, tz `Asia/Dushanbe`: резолюции (`docflow.deadline`), шаги маршрутов (`docflow.route_deadline`) и задачи (`tasks.deadline`) → строки в `app.notification_outbox` |
| `retention` | repeatable `sweep`, `0 3 * * *` (без `tz` — по времени процесса worker'а): среди прочего `markDispositionCandidates()` — единственное, что машина решает об архиве |
| `av-scan` | антивирус для вложений; документ не отдаётся, пока версия не `clean` |
| `preview`, `text-extract` | превью вложений и извлечение текста (текст уходит в полнотекстовый поиск по документам) |
| `audit-maintenance` | repeatable `ensure`, `0 3 1 * *`: партиции `audit.audit_log` на два месяца вперёд |
| `email` | отправка писем-уведомлений |
| `geo-import`, `geo-export` | к СЭД отношения не имеют |
| `meet-ring`, `meet-reminder` | к СЭД отношения не имеют и потребляются в **api**, не в worker'е |

Сам worker только **пишет** строки в `app.notification_outbox`; рассылает их диспетчер внутри api
(`DocflowDeadlineOutboxService`, опрос раз в 5 с). Поэтому «уведомления не приходят» — это две
разные неисправности: строк нет (лежал worker) или строки есть с `processed_at is null` (лежит
диспетчер, см. §2).

### Диагностика

```bash
dc ps worker
# Суточные отметки: обе строки должны появляться раз в день.
dc logs worker --since 24h | grep -E "deadline sweep|retention sweep complete"
```

- Экран `/app/admin/health` → «Очереди» (право `admin.system.monitor`), он же
  `GET /api/v1/admin/health`: по каждой очереди `waiting / active / failed / delayed / completed`.
  **Растущий `waiting` при `active = 0` — никто не потребляет очередь.** Одни только нули ни о чём
  не говорят: их же вернёт и недоступный Redis (чтение счётчиков вырождается в нули по таймауту).
- Повторить упавшие задания: кнопка на том же экране или
  `POST /api/v1/admin/health/queues/:name/retry` (`:name` — имя очереди из таблицы выше).

```sql
-- Есть ли свежие уведомления вообще (worker пишет — api рассылает).
SELECT topic, count(*) FILTER (WHERE processed_at IS NULL) AS pending, count(*) AS total
FROM app.notification_outbox
WHERE created_at > now() - interval '2 days'
GROUP BY topic;
```

### Что ломается, если worker не работает

- **Вложения СЭД зависают в `av_status = 'pending'`** → скачивание файла документа отвечает 403
  `docflow.file.not_safe` («не прошёл антивирусную проверку»), и входящее из карантина обмена
  нельзя зарегистрировать — для этого нужны все вложения `clean`. Это самое заметное последствие:
  выглядит как «сломались файлы», а не как «лежит worker».
- **Нет напоминаний и эскалаций** по резолюциям и шагам маршрутов; пропущенный слот 08:00 не
  догоняется (§2, §5).
- **Никто не помечает архивных кандидатов** (03:00). На сохранность это не влияет: `candidate` —
  подсказка, а не решение, и любой акт всё равно собирает человек.
- **Не создаются партиции `audit.audit_log`** вперёд — записи попадают в DEFAULT-партицию, ничего
  не теряется, но разгребать её придётся отдельно.
- **Письма копятся** в очереди `email`; внутренние уведомления в интерфейсе при этом работают —
  их фан-аут живёт в api.

---

## 8. Что мониторить постоянно

Метрики, по которым видно три цикла и состояния из §§4–7 (`docs/runbook-monitoring.md` — там же
дашборд):

| Показатель | Норма | Тревога |
|---|---|---|
| Незакрытые просроченные гейты | 0 дольше 2 минут | > 0 держится 10 минут |
| `notification_outbox` topic `docflow.deadline` за сутки | > 0 при наличии контрольных активных резолюций с датой | 0 два дня подряд |
| `document_dispatches` due_now | близко к 0 | растёт монотонно 15 минут |
| `document_dispatches` in_flight | 0 (захват живёт секунды) | > 0 держится 5 минут |
| `document_dispatches` dead_lettered | разбирается оператором | растёт без разбора |
| `document_exchange_inbound` в карантине | разбирается оператором | старше суток |
| Дубли `reg_number` внутри журнала | 0 (держит индекс) | любая строка в запросе §4 |
| Регистрация в журнале | проходит | unique violation по `documents_journal_reg_number_uq` в логе api |
| Активные шаги маршрутов без исполнителей | 0 | появился хоть один (§5, второй запрос) |
| Документы под legal hold | все с внятной причиной | запрет без `legal_hold_reason` |
| `waiting` в очередях `av-scan` / `deadlines` | около 0 | растёт при `active = 0` |

## 9. Известные ограничения

- Пропущенный слот дедлайнов (worker лежал в 08:00) **не догоняется** автоматически.
  Дедупликация по дню делает ручной повтор безопасным, но повтор нужно инициировать.
- Ручного триггера гейта нет намеренно — это была бы возможность открыть чужое ознакомление
  досрочно в обход правил.
- Транспорт обмена (mTLS, хранилище секретов) на момент написания не выбран заказчиком —
  реализован только файловый адаптер (`DOCFLOW_EXCHANGE_DIR`).
- Счётчик регистрации нельзя ни посмотреть, ни поправить через API — только SQL по
  `app.journal_counters`. Соответственно, и правка не попадает в аудит.
- Валидация `number_template` требует только токен `{seqN}`: журнал с `seq_reset = 'yearly'` и
  шаблоном без года принимается и заклинит в январе (§4).
- Принудительного закрытия, переназначения или отмены шага маршрута администратором нет; состав
  запущенного маршрута не редактируется. Штатные выходы — назначение на должность, подстановка
  или отклонение шага с перезапуском маршрута (§5).
- `POST …/route/validate` проверяет определение маршрута, а не уже запущенный маршрут.
- `activePrincipalsFor` не фильтрует `scope` подстановки: `docflow` и `all` действуют на маршруты
  одинаково.
- Из акта на уничтожение нельзя убрать отдельный документ — эндпоинта удаления позиций нет,
  а добавлять их можно только в черновик. Пока акт в `pending`, выход — отклонить его целиком и
  собрать новый; после утверждения отклонение уже запрещено (`reject` только из `pending`), и
  утверждённый акт с документом под legal hold без снятия запрета не разблокировать (§6).
- Захваченная попытка отправки (`pending` + `next_attempt_at IS NULL`) при падении процесса
  остаётся невидимой для цикла и для API-повтора; подобрать её может только оператор SQL-ом (§3).
- Отдельной роли «архивариус» нет: `docflow.archive.hold` и `docflow.archive.dispose` есть только
  у шаблона `chief`, а пункт «Архив» в навигации показывается по `docflow.register` — руководитель
  попадает на экран по прямому адресу.
- У процесса worker нет эндпоинта здоровья: его состояние видно только по очередям
  (`/app/admin/health`), логам и `dc ps`.
