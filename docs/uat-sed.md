# UAT СЭД 2.0 — протокол приёмки AC-SED-01 … AC-SED-07

Документ фиксирует, чем именно подтверждён каждый пронумерованный шаг сквозных сценариев приёмки
из `docs/plan/sed_plan_implementation.md` §13. Это протокол покрытия, а не отчёт о прогоне: автотесты
в рамках подготовки этого документа не запускались (общий throttle логина не позволяет параллельный
прогон — см. §«Как прогнать»).

## Метод

- **Шаг считается покрытым**, только если конкретный тест реально утверждает его результат
  (`expect`), а не «лежит рядом по имени файла». Если такого утверждения нет — в колонке «где»
  стоит `—`, а под таблицей описана ручная проверка для приёмщика.
- **Градация**: `да` — шаг доказан автоматически целиком; `частично` — доказана часть (обычно
  либо только unit-уровень, либо тест опциональный/skip по умолчанию, либо проверен не тот актор);
  `нет` — автоматического подтверждения не существует.
- Ссылки даны в формате `путь:строка — имя теста`. Строка указывает на объявление `test(...)` /
  `it(...)` / `describe(...)`.

### Фикстуры и роли — важная оговорка

Сценарии написаны в терминах должностей («clerk», «директор», «архивариус»), но e2e-набор
провизионирует пять учётных записей (`packages/db/src/seed-e2e.ts`, `provision()`), из которых
спеки ДОУ используют три:

| Фикстура | Роль | Что это значит для протокола |
|---|---|---|
| `e2e_admin` | `superadmin` (wildcard) | Все канцелярские, руководящие и архивные действия в e2e выполняет он. Разделение обязанностей на этих шагах **не** доказано. |
| `e2e_user` | `employee` | `docflow.use` + `docflow.create`. Используется как «исполнитель без прав канцелярии». |
| `e2e_user2` | `employee` | То же; играет «постороннего» в проверках ДСП и видимости. |
| `e2e_duty` | `duty_officer` | В спеках ДОУ не используется. Из прав ДОУ имеет только `docflow.use` — готовый актор для отрицательных проверок прав (см. C.19). |
| `e2e_sughd` | `duty_officer`, привязан к `SUGHD_ORG_UNIT_ID` | То же плюс другое подразделение — актор для проверок видимости по подразделению. |

Отдельно, по факту чтения `packages/shared/src/permissions/index.ts`:

- **Роли «архивариус» в системе нет.** Права `docflow.archive.hold` / `docflow.archive.dispose`
  входят только в шаблон `chief` (Руководитель). Там, где сценарий AC-SED-05 говорит «Archivist»,
  читать следует «держатель `docflow.archive.hold` / `docflow.archive.dispose`», а сегодня это
  руководитель либо суперадмин.
- `docflow.journals.manage` выдаётся двум шаблонам: `clerk` (Делопроизводитель) и
  `platform_admin` (Администратор платформы — вместе с `docflow.use`); суперадмин получает право
  через wildcard. `chief` его не имеет. Прежний пробел «журналами управляет только суперадмин»
  закрыт, поэтому в разделе «Не покрыто автоматически» отдельных пунктов по нему больше нет.

Пробел с «архивариусом» — известный и реальный; в разделе «Не покрыто автоматически» он вынесен
отдельным пунктом, потому что влияет на приёмку прав доступа, а не только на тесты.

---

## AC-SED-01. Входящий с ранним ознакомлением

| шаг | покрыто | где |
|---|---|---|
| 1. Clerk загружает PDF и атомарно регистрирует входящий | частично | `apps/web/e2e/docflow-register-incoming.spec.ts:59` — `docflow: register-incoming is atomic and idempotent on a client key`; `apps/web/e2e/docflow-register-incoming.spec.ts:133` — `docflow: register-incoming rejects the wrong journal class and a non-clerk` (403 без `docflow.register`); `apps/web/src/features/docflow/components/RegisterWizard.test.tsx:58` — `registers with ONE atomic command, not create → attach → register` |
| 2. Номер соответствует журналу и календарю Душанбе | частично | `apps/api/src/modules/docflow/docflow-numbering.service.spec.ts:84` — `DocflowNumberingService.allocate — Asia/Dushanbe registration period` (в т.ч. `:95` «files the last five hours of 31 December under the NEXT year», `:104`, `:111`, `:116`); `:46` — `buckets a yearly journal under the calendar year and formats the number`; `apps/web/e2e/docflow-register-incoming.spec.ts:59` (формат `ВХ-\d{4}/\d{4}`); `apps/api/src/modules/docflow/documents.service.spec.ts:154` — `assertIncomingJournal` |
| 3. Clerk отправляет проект резолюции директору | да | `apps/web/e2e/docflow-resolution-proposals.spec.ts:93` — `proposals: only the named signer decides, and a rejection issues nothing` (create + submit, подписант — другой пользователь); `:255` — `proposals: a proposal needs a registered document` |
| 4. Директор утверждает: один ответственный, два соисполнителя, два знакомящихся | частично | `apps/web/e2e/docflow-resolution-proposals.spec.ts:175` — `proposals: readers gate the instruction, and the last one opens it early` (один ответственный + два знакомящихся); `apps/api/src/modules/docflow/resolution-proposals.policy.spec.ts:36` — `lets the named signer decide, unattributed`; `:47` — `refuses anyone else, however senior` |
| 5. Исполнители ещё не видят поручение | частично | Только для единственного ответственного исполнителя: `apps/web/e2e/docflow-resolution-proposals.spec.ts:175` (строка 213: очередь `my_tasks` не содержит документ, пока gate закрыт); `apps/api/src/modules/docflow/resolution-proposals.policy.spec.ts:104` — `keeps availableAt in step with releaseAt` |
| 6. Оба знакомящихся подтверждают через 30 минут | частично | `apps/web/e2e/docflow-resolution-proposals.spec.ts:175` (оба acknowledge; повторный клик безвреден, строка 230) |
| 7. Gate снимается с reason `all_acknowledged` | да | `apps/web/e2e/docflow-resolution-proposals.spec.ts:175` (строки 241–246: `releasedAt` + `releasedReason === 'all_acknowledged'` + все строки `acknowledged`); `apps/api/src/modules/docflow/resolution-proposals.policy.spec.ts:120` — `opens early once everyone has read it` |
| 8. Исполнители получают одно уведомление и видят поручение | частично | Видят: `apps/web/e2e/docflow-resolution-proposals.spec.ts:175` (строка 249). Уведомление: `—` |
| 9. История и audit содержат все действия | нет | `—` |

**Почему «частично»/«нет» и что проверить руками**

- **Шаг 1.** Успешная атомарная регистрация *с реально приложённым файлом* не покрыта нигде.
  `register-incoming` с массивом `files` проверяется только на пути отказа
  (`apps/web/e2e/docflow-register-incoming.spec.ts:94` — `a failed register-incoming leaves no draft
  and burns no number`, несуществующий `fileId` → 400, документ не создан, номер не сожжён), а
  визард в unit-тесте отправляет `files: []`.
  *Ручная проверка:* в мастере «Зарегистрировать входящий» приложить настоящий PDF, зарегистрировать
  одной кнопкой, убедиться, что карточка сразу `Зарегистрирован`, файл виден на карточке, а после
  отработки антивируса скачивается.
- **Шаг 2.** Половина про **календарь Душанбе** доказана только на unit-уровне: `allocate`
  вызывается с поддельной транзакцией (`fakeTx`, фиксированный `lastSeq`), реальный запрос к БД в
  этих кейсах не выполняется. Единственная e2e-цитата
  (`apps/web/e2e/docflow-register-incoming.spec.ts:59`) утверждает лишь формат номера
  `ВХ-\d{4}/\d{4}` — она прошла бы и на реализации, считающей год по UTC. Соответствие журналу
  (класс книги) при этом доказано и e2e, и unit.
  *Ручная проверка:* в ночь на 1 января (или сдвинув время стенда на `31.12 19:30 UTC`)
  зарегистрировать входящий и убедиться, что номер ушёл в книгу следующего года.
- **Шаг 4.** Соисполнители (`coExecutorIds` в проекте резолюции) **не фигурируют ни в одном тесте** —
  ни e2e, ни unit. Проверен вариант «один ответственный + два знакомящихся».
  *Ручная проверка:* утвердить проект с двумя соисполнителями и убедиться, что после снятия gate
  поручение появляется в «Моих поручениях» у всех троих.
- **Шаг 5.** Невидимость поручения за закрытым gate проверена ровно для одного актора —
  ответственного исполнителя `e2e_user2` (`apps/web/e2e/docflow-resolution-proposals.spec.ts:175`,
  строки 203–213). Соисполнителей в тесте нет вовсе (см. шаг 4), поэтому «исполнители» во
  множественном числе автоматически не подтверждены.
  *Ручная проверка:* совмещается с проверкой шага 4 — до снятия gate поручения не должно быть в
  «Моих поручениях» ни у ответственного, ни у обоих соисполнителей.
- **Шаг 6.** «Через 30 минут» не моделируется: подтверждения идут подряд, без задержки. Проверено
  только то, что gate держится при одном оставшемся читателе и открывается на последнем.
- **Шаг 8.** Уведомление о назначенном поручении не проверяет ни e2e, ни unit-тест. Уведомления
  модуля ДОУ покрыты выборочно: отклонение маршрута — `apps/web/e2e/docflow-routes.spec.ts:112`
  (строки 151–163), напоминания о сроках —
  `apps/api/src/modules/docflow/docflow-deadline-outbox.service.spec.ts:44` (и `:53`, `:60`);
  выдача поручения — нигде. Дедупликация
  «одно уведомление на исполнителя» обеспечивается кодом (`new Set([row.executorId,
  ...row.coExecutors])` в `apps/api/src/modules/docflow/resolution-proposals.service.ts:637`,
  внутри `notifyExecutorsForBatch` — объявление на `:625`), но не проверяется.
  *Ручная проверка:* у исполнителя должно появиться ровно одно уведомление «Новое поручение», даже
  если он одновременно и ответственный, и соисполнитель.
- **Шаг 9.** Ни один тест не утверждает наличие событий этого сценария (подача/утверждение проекта,
  создание и снятие gate) в `История`/audit. Существующие проверки истории относятся к другим
  событиям и в качестве покрытия здесь не засчитаны.
  *Ручная проверка:* на вкладке «История» карточки должны быть, по порядку: регистрация, подача
  проекта резолюции, утверждение, создание резолюции, снятие gate; каждое — с актором и временем в
  Asia/Dushanbe.

---

## AC-SED-02. Входящий с таймаутом

| шаг | покрыто | где |
|---|---|---|
| 1. После approve один знакомящийся не отвечает | частично | `apps/web/e2e/docflow-acquaintance-timeout.spec.ts:42` — `a timeout opens the gate once and marks the silent reader expired` (**opt-in, по умолчанию skip**) |
| 2. До `release_at` исполнители не видят поручение | да | `apps/web/e2e/docflow-resolution-proposals.spec.ts:175` (строка 213); `apps/api/src/modules/docflow/resolution-proposals.policy.spec.ts:97` — `opens the gate the configured number of hours out` (и `ACQUAINTANCE_GATE_HOURS === 4`); `:104` — `keeps availableAt in step with releaseAt` |
| 3. Worker на границе четырёх часов выпускает batch один раз | частично | `apps/web/e2e/docflow-acquaintance-timeout.spec.ts:42` (opt-in; `releasedReason === 'timeout'`); `apps/api/src/modules/docflow/resolution-proposals.policy.spec.ts:129` — `opens on the timeout even with readers outstanding`; `:134` — `is a no-op once the gate is already open — the racer that lost does nothing` |
| 4. Неответивший получает `expired` | частично | `apps/web/e2e/docflow-acquaintance-timeout.spec.ts:42` (opt-in; строка 117 — `silence is not compliance`); `apps/web/src/features/docflow/components/ProposalsSection.test.tsx:143` — `reports a released gate by the reason it opened for` (строка «Не ознакомился») |
| 5. Исполнители получают поручение | частично | `apps/web/e2e/docflow-acquaintance-timeout.spec.ts:42` (opt-in; строка 124) |
| 6. Одновременный поздний acknowledge не создаёт двойной release | частично | `apps/api/src/modules/docflow/resolution-proposals.policy.spec.ts:134` — `is a no-op once the gate is already open — the racer that lost does nothing` |

**Почему «частично» и что проверить руками**

- Весь сценарий держится на одном спеке, который **по умолчанию пропускается**: он требует API,
  поднятого с укороченным gate, и переменной `GATE_TIMEOUT_E2E` (см. шапку
  `apps/web/e2e/docflow-acquaintance-timeout.spec.ts:14-17`). В обычном `pnpm e2e` шаги 1, 3, 4, 5
  не проверяются вовсе. Команда прогона — в §«Как прогнать».
- **Шаг 3.** Сам планировщик (`apps/api/src/modules/docflow/acquaintance-gate.service.ts`) не имеет
  unit-теста. Однократность выпуска обеспечена предикатом `released_at is null` в `UPDATE` и
  подтверждается только на уровне чистой функции `planRelease`. Множественные инстансы API
  одновременно не проверялись.
- **Шаг 6.** Гонка «поздний acknowledge против sweep» проверена только как чистая функция; реальной
  параллельной гонки против PostgreSQL в тестах нет.
  *Ручная проверка:* дождаться таймаута и сразу нажать «Ознакомлен» у молчавшего читателя — второго
  release, второго уведомления и подмены `releasedReason` быть не должно.

---

## AC-SED-03. Исходящий ответ

| шаг | покрыто | где |
|---|---|---|
| 1. Из входящего создаётся ответ | да | `apps/web/e2e/docflow-outgoing-response.spec.ts:114` — `outgoing: incoming → response → approve → sign → register → send`; `:373` — `outgoing: an answer is only prepared for a registered incoming document`; `apps/web/e2e/docflow-documents-ui.spec.ts:113` — `docflow UI: create the answer to an incoming letter from its card` |
| 2. Корреспондент и связь заполнены, доступ не расширен | да | `apps/web/e2e/docflow-outgoing-response.spec.ts:114` (строки 149–164: `recipientName` из отправителя, двусторонняя связь `reply`); `:330` — `outgoing: a response inherits ДСП without widening its allow-list` |
| 3. Подготовитель редактирует файл/реквизиты | частично | `apps/web/e2e/docflow-editing.spec.ts:57` — `editing: a preparer edits the draft but gets nothing else` (реквизиты; `availableActions === ['edit']`, гриф — 404, приглашения — 403) |
| 4. Руководитель согласует, подписант подписывает ECDSA | да | `apps/web/e2e/docflow-outgoing-response.spec.ts:114` (строки 192–231); `apps/web/e2e/docflow-signatures.spec.ts:120` — `signatures: route → sign → verify the full outgoing cycle, and a file swap breaks it`; `apps/api/src/modules/docflow/signature-crypto.spec.ts:58` — `verifies a document signature and rejects a tampered payload`; `apps/api/src/modules/docflow/route-step-actions.spec.ts:43` — `refuses to close a signature step with a plain approval` |
| 5. Канцелярия получает registration step и регистрирует | частично | `apps/web/e2e/docflow-route-invariants.spec.ts:148` — `routes: an execute step is closed by complete, and registering closes a register step`; `apps/api/src/modules/docflow/response-route-preset.spec.ts:85` — `adds a register step only when a registry unit is named`; `apps/api/src/modules/docflow/route-step-actions.spec.ts:62` — `refuses to close a register step without minting a number` |
| 6. До регистрации dispatch запрещён | да | `apps/web/e2e/docflow-outgoing-response.spec.ts:114` (строки 167–172: 422 `docflow.dispatch.not_registered`); `apps/api/src/modules/docflow/dispatch-policy.spec.ts:38` — `refuses an unregistered document — the envelope would carry no number` |
| 7. Канцелярия фиксирует ручную отправку и квитанцию | да | `apps/web/e2e/docflow-outgoing-response.spec.ts:114` (строки 255–311: pending → fail → retry → confirm с `externalReference` и `receiptFileId`, история из двух попыток, повторное решение — 409); `apps/api/src/modules/docflow/dispatch-policy.spec.ts:70` — `always allows the manual channels — a human performs them and records the fact` |
| 8. Обе карточки показывают связь и полную timeline | частично | Связь: `apps/web/e2e/docflow-outgoing-response.spec.ts:114` (строки 154–164); `apps/web/e2e/docflow-ui-backend.spec.ts:57` — `docflow 3.7: queue counts, row action steps, links and history` (двусторонность, дубль → 409, self-link → 400) |

**Почему «частично» и что проверить руками**

- **Шаг 3.** Права подготовителя доказаны на входящем черновике, а не на исходящем ответе, и только
  для реквизитов. Прикрепление файла в сценарии выполняет автор/админ
  (`apps/web/e2e/docflow-outgoing-response.spec.ts:114`, строки 175–180), а не назначенный
  подготовитель.
  *Ручная проверка:* назначить на ответ подготовителя, из-под него заменить основной файл и изменить
  реквизиты, убедиться, что регистрация и гриф ему по-прежнему недоступны.
- **Шаг 5.** Сквозной сценарий строит маршрут вручную из двух шагов (`approve`, `sign`) и регистрирует
  документ тем же администратором — отдельный шаг `register`, доставшийся канцелярии, в нём не
  участвует. Что регистрация закрывает `register`-шаг, проверено в другом спеке и на другом типе
  документа (внутренний приказ); что пресет ответа добавляет такой шаг — только на уровне чистой
  функции.
  *Ручная проверка:* создать ответ с включённым «Сразу отправить на согласование», указав канцелярию
  как подразделение-регистратор; убедиться, что после подписи шаг «Регистрация» становится активным
  именно у канцелярии, а регистрация его закрывает.
- **Шаг 8.** Timeline исходящей карточки целиком нигде не утверждается. Проверено только, что timeline
  вообще пишется и не содержит значений полей
  (`apps/web/e2e/docflow-editing.spec.ts:134` — `editing: requisites freeze after registration, and the
  timeline names the changed fields`) — это другое утверждение и в покрытие шага не засчитано.
  *Ручная проверка:* открыть «Историю» обеих карточек и сверить, что там есть весь путь: создание
  ответа, согласование, подпись, регистрация, попытка отправки, отказ, повтор, подтверждение с
  квитанцией.

---

## AC-SED-04. Возврат на доработку

| шаг | покрыто | где |
|---|---|---|
| 1. Approver отклоняет с обязательным комментарием | да | `apps/web/e2e/docflow-routes.spec.ts:112` — `docflow routes: a rejection returns the document to the author as a draft` (без комментария — 400, с комментарием — ok); `apps/api/src/modules/docflow/route-step-actions.spec.ts:37` — `lets every kind be declined — reject is the recovery path back to the author` |
| 2. Route отменён/возвращён, документ снова редактируем | да | `apps/web/e2e/docflow-routes.spec.ts:112` (маршрут `cancelled`, документ `draft`); `apps/web/e2e/docflow-acceptance.spec.ts:192` — `acceptance: relaunching a rejected route keeps the first cycle in the history`; `apps/api/src/modules/docflow/document-actions.spec.ts:39` — `covers the draft and the rework state, nothing past registration` |
| 3. Автор видит comment и уведомление | да | Comment: `apps/web/e2e/docflow-acceptance.spec.ts:192` (строка 227 — `decision === 'rejected'` и текст комментария сохранён). Уведомление: `apps/web/e2e/docflow-routes.spec.ts:112` — `docflow routes: a rejection returns the document to the author as a draft` (строки 151–163: в ленте автора появляется уведомление `docflow.document.route_rejected` с `entityId` документа) |
| 4. После правки запускает новую версию маршрута | да | `apps/web/e2e/docflow-acceptance.spec.ts:192` (цикл 2 `active`) |
| 5. Старые решения остаются неизменяемой историей | да | `apps/web/e2e/docflow-acceptance.spec.ts:192` (цикл 1 `cancelled`, решение и комментарий на месте, оба цикла возвращаются) |

**Примечание**

Ранее шаг 3 стоял «частично»: ветка `reject` в
`apps/api/src/modules/docflow/routes.service.ts` писала audit и realtime-событие, но не создавала
персистентного уведомления. Сейчас пробел закрыт — после транзакции вызывается
`notifications.notify({ type: 'docflow.document.route_rejected', … })` для автора документа
(`routes.service.ts:955-966`; уведомление не шлётся, если автор сам и отклонил), а e2e утверждает
его появление в ленте автора. Это единственный сценарий, покрытый автотестами полностью.

---

## AC-SED-05. Архив и hold

| шаг | покрыто | где |
|---|---|---|
| 1. Завершённый документ архивируется в номенклатурное дело | да | `apps/web/e2e/docflow-archive.spec.ts:93` — `archive: filing freezes the term the case stated, and a later edit does not move it`; `:346` — `archive: the status command cannot archive — filing into a case is the only way in`; `apps/web/e2e/docflow-acceptance.spec.ts:116` — `acceptance: the full incoming cycle runs register → resolution → execution → «в дело»`; `apps/api/src/modules/docflow/archive-policy.spec.ts:87` — `assertArchivable` |
| 2. Получает retention snapshot | да | `apps/web/e2e/docflow-archive.spec.ts:93` (срок 60 мес. заморожен и не двигается после правки дела); `:135` — `archive: a permanent case is never a candidate, and restore needs a reason`; `apps/api/src/modules/docflow/archive-policy.spec.ts:43` — `freezes a term of months onto the document`; `:77` — `is a snapshot: the same input always yields the same date, whatever the rule becomes` |
| 3. До срока не появляется в кандидатах | частично | Отказ по живому сроку на другом пути (внесение в акт): `apps/web/e2e/docflow-archive.spec.ts:225` — `archive: no document reaches an act while its term is alive, and an empty act decides nothing` (строка 257 — 422 `docflow.archive.retention_active`); сама выборка кандидатов — только чистой функцией: `apps/api/src/modules/docflow/archive-policy.spec.ts:147` — `leaves an active term alone` |
| 4. После срока появляется | частично | `apps/api/src/modules/docflow/archive-policy.spec.ts:143` — `marks an archived document whose term has run out` |
| 5. Держатель `docflow.archive.hold` ставит legal hold с причиной | частично | `apps/web/e2e/docflow-archive.spec.ts:173` — `archive: a legal hold cannot be got round by the raw API` (причина сохраняется и возвращается); `apps/web/src/features/docflow/components/ArchiveSection.test.tsx:116` — `sends the hold reason both ways`; `:77` — `renders a legal hold loudly, with its reason` |
| 6. disposition API и UI блокируют выбытие | частично | API: `apps/web/e2e/docflow-archive.spec.ts:173` (409 `docflow.archive.legal_hold` при попытке внести в акт); `apps/api/src/modules/docflow/archive-policy.spec.ts:183` — `refuses a legal hold before anything else`; `:158` — `never marks a document under legal hold, however old` |
| 7. После снятия hold требуется новый явный review/approve | частично | `apps/api/src/modules/docflow/archive-policy.spec.ts:230` — `walks draft → pending → approved → executed`; `:237` — `never executes an act nobody approved`; `:266` — `refuses the author reviewing their own act`; `:308` — `refuses one held between approval and execution`; `apps/web/e2e/docflow-archive.spec.ts:225` (draft → execute → 409 `docflow.disposition.invalid_transition`) |

**Почему «частично» и что проверить руками**

- **Шаг 3.** Ранее здесь стояла цитата `apps/web/e2e/docflow-archive.spec.ts:287` (строка 313 —
  свежеподшитого документа нет в `candidatesOnly`). Она снята: **это утверждение не может упасть**.
  Фильтр `candidatesOnly` читает флаг — `eq(documents.dispositionStatus, 'candidate')`
  (`apps/api/src/modules/docflow/archive.service.ts:270`), а флаг проставляет только sweep-проход
  (`apps/worker/src/queues/retention/retention.processor.ts:101`). У свежеподшитого документа
  `dispositionStatus = 'none'` — это утверждает соседний тест `:225` на строке 281, — поэтому он
  отсутствовал бы в кандидатах и с истёкшим сроком. Свойство «срок жив ⇒ в кандидаты не берём»
  реально доказано только чистой функцией `isDispositionCandidate` и отказом 422 на пути внесения
  в акт.
  *Ручная проверка:* подшить документ с живым сроком, дождаться sweep-прохода retention и
  убедиться, что на вкладке «Кандидаты к выбытию» его нет, а `dispositionStatus` остался `none`.
- **Шаг 4.** Появление документа в кандидатах после истечения срока принципиально недостижимо в e2e:
  минимальный срок хранения, который принимает номенклатура, — один месяц, а отсчёт идёт от даты
  подшивки (объяснение — в комментарии `apps/web/e2e/docflow-archive.spec.ts:231`). Доказано только
  чистой функцией.
  *Ручная проверка:* на стенде подшить документ в дело, руками сдвинуть `retention_until` в прошлое
  (или дождаться срока), дождаться sweep-прохода и убедиться, что документ появился на вкладке
  «Кандидаты к выбытию».
- **Шаг 5.** Роль. Hold ставит `e2e_admin` (superadmin). Что именно держатель `docflow.archive.hold`
  (шаблон `chief`) может это сделать, а `clerk`/`employee` — нет, автотестами не проверено; роли
  «архивариус» в системе нет.
  *Ручная проверка:* под пользователем с ролью «Делопроизводитель» убедиться, что действия
  «Наложить запрет» и акты о выделении недоступны; под «Руководителем» — доступны.
- **Шаг 6.** «UI блокирует выбытие» подтверждён только косвенно: секция архива на карточке громко
  показывает hold с причиной, а страница архива объясняет правило двух лиц
  (`apps/web/e2e/docflow-archive.spec.ts:318` — `archive UI: the page shows the inventory, warns about
  candidates and exports the опись`). Что кнопка добавления в акт для документа под hold отсутствует
  или задизейблена — не утверждается ни одним тестом.
  *Ручная проверка:* попытаться добавить документ под hold в акт о выделении через UI — действие
  должно быть недоступно, а не падать ошибкой после нажатия.
- **Шаг 7.** Сквозного пути «снял hold → внёс в акт → submit → approve (другим лицом) → execute» нет:
  e2e снимает hold и на этом останавливается (`apps/web/e2e/docflow-archive.spec.ts:173`, строки
  214–220). Невозможность срезать углы доказана на уровне state-машины.
  *Ручная проверка:* после снятия hold провести документ через полный акт и убедиться, что
  утверждающий — не автор акта (иначе `docflow.disposition.self_review`).

---

## AC-SED-06. Конфиденциальность

| шаг | покрыто | где |
|---|---|---|
| 1. ДСП-документ разрешён A, запрещён B | да | `apps/web/e2e/docflow-dsp.spec.ts:42` — `dsp: access list alone is not enough — the confidential.view право is required`; `apps/web/e2e/docflow-documents.spec.ts:94` — `docflow: a ДСП document is invisible to a non-participant`; `apps/api/src/modules/docflow/document-visibility.spec.ts:29` — `requires BOTH access-list membership AND docflow.confidential.view for ДСП`; `:44` — `never yields ДСП to registry access alone` |
| 2. B не видит его в list/count/search/dashboard/Cmd+K | частично | list: `apps/web/e2e/docflow-dsp.spec.ts:42` (строки 74–80); search + total: `apps/web/e2e/docflow-search.spec.ts:128` — `search: a ДСП document is invisible to the undopusked — no row, no count, no snippet` (строки 152–153); Cmd+K: там же, строки 156–162 |
| 3. B не получает snippet, download, preview, comment, link или timing oracle | частично | snippet: `apps/web/e2e/docflow-search.spec.ts:128` — только косвенно, строки 152–153 (ни строки, ни `total`, значит и сниппета нет); прямой assert на строке 154 сломан — см. ниже; download: `apps/web/e2e/docflow-files.spec.ts:195` — `docflow files: a ДСП body is unreachable without the allow-list` (404, тот же, что у карточки); карточка по прямому id: `apps/web/e2e/docflow-search.spec.ts:128` (строка 165); чужой файл через свой документ: `apps/web/e2e/docflow-files.spec.ts:169` — `docflow files: a foreign document and a foreign file id are both 404` |
| 4. A открывает карточку/файл; чтение фиксируется | частично | Карточка: `apps/web/e2e/docflow-dsp.spec.ts:96` — `dsp: a non-author open is written to the read log` (актор в журнале чтений — тот, кто открыл) |
| 5. Socket.IO payload не раскрывает тему/текст B | нет | `—` |

**Почему «частично»/«нет» и что проверить руками**

- **Шаг 2.** Не проверены `dashboard` и счётчики «Требует внимания» на предмет ДСП. Существующий тест
  `apps/web/e2e/docflow-search.spec.ts:228` (`attention: counts agree with the queues, and hide what the
  caller may not see`) проверяет другое — что очереди, требующие права (`disposition_candidates`,
  `awaiting_dispatch`), у сотрудника отсутствуют как ключи, а не обнулены. Это ценно, но шага про ДСП
  не доказывает.
  *Ручная проверка:* под B открыть дашборд и панель «Требует внимания» — ни один счётчик не должен
  измениться от появления ДСП-документа, к которому B не допущен.
- **Шаг 3, сниппет.** Прямая проверка сниппета не работает:
  `expect(JSON.stringify(theirs)).not.toContain(word.toUpperCase().slice(0, 6))`
  (`apps/web/e2e/docflow-search.spec.ts:154`) ищет «СЕКРЕТ» прописными, тогда как искомое слово
  (`секретслово${stamp}`) везде строчное, а `String.includes` регистрозависим — при реальной утечке
  тело ответа содержало бы «секрет» строчными и проверка всё равно прошла бы. Отсутствие сниппета
  следует лишь косвенно, из строк 152–153 (пустой `items` и `total === 0`). **Сломанный assert
  следует завести отдельным дефектом теста.**
- **Шаг 3, каналы.** Не покрыты три канала из шести:
  - `preview` — эндпоинт `GET /documents/:id/files/:fileId/preview` существует
    (`apps/api/src/modules/docflow/documents.controller.ts:278`) и проходит тот же гейт в коде, но
    теста на 404 под B нет;
  - `comment` — отдельной сущности комментариев в модуле ДОУ не обнаружено; если приёмка имеет в виду
    комментарии шагов маршрута, они доступны только через карточку, которая уже 404;
  - `timing oracle` — измерений времени ответа для «существует/не существует» нет ни в одном тесте.
  *Ручная проверка:* под B дёрнуть `preview` ДСП-файла (ожидается 404, не 403), и сравнить время
  ответа `GET /documents/{ДСП-id}` с временем ответа на заведомо несуществующий UUID — разница не
  должна быть систематической.
- **Шаг 4.** Запись *чтения тела файла* в журнал не утверждается: тест
  `apps/web/e2e/docflow-files.spec.ts:195` в конце лишь проверяет, что `/read-log` возвращает массив
  (строки 225–228). Код пишет запись (`apps/api/src/modules/docflow/docflow-files.service.ts:212` для
  download и `:228` для preview), но тестом это не закреплено.
  *Ручная проверка:* скачать ДСП-файл под допущенным пользователем и убедиться, что в журнале чтений
  карточки появилась запись с этим актором и временем.
- **Шаг 5.** Тестов на Socket.IO в модуле ДОУ нет ни одного. По коду payload действительно узкий —
  `emitToUser(userId, 'docflow.resolution.updated', { documentId, action, actorId })`
  (`apps/api/src/modules/docflow/resolution-proposals.service.ts:648`; та же тройка полей и в
  комнатном `emitUpdated`, `:65`) — ни темы, ни текста; тело уведомления — обобщённое («Вам
  назначено поручение по документу.»). Но что B вообще не получает событий по чужому
  ДСП-документу, не проверено.
  *Ручная проверка:* открыть под B вкладку с DevTools, под A выполнить действия по ДСП-документу и
  убедиться, что в WS-кадрах у B нет ни `documentId` этого документа, ни темы, ни текста.

---

## AC-SED-07. Нагрузка регистрации

| шаг | покрыто | где |
|---|---|---|
| 1. 50 параллельных запросов регистрируются в одном журнале | да | `apps/web/e2e/docflow-acceptance.spec.ts:69` — `acceptance: 50 concurrent registrations mint a unique, gap-free sequence` (свежий журнал, 50 черновиков, `Promise.all` регистраций, все 2xx) |
| 2. Все номера уникальны и последовательны | да | `apps/web/e2e/docflow-acceptance.spec.ts:69` (строки 108–111: `Set(numbers).size === 50` и последовательность ровно `1..50`); `apps/api/src/modules/docflow/docflow-numbering.service.spec.ts:148` — `mints 50 unique, gap-free numbers in the local-calendar bucket` |
| 3. Нет потерянных/двойных counters | да | `apps/web/e2e/docflow-acceptance.spec.ts:69` (отсутствие пропусков — это и есть отсутствие потерянных счётчиков); `apps/web/e2e/docflow-register-incoming.spec.ts:94` — `a failed register-incoming leaves no draft and burns no number`; `apps/api/src/modules/docflow/docflow-numbering.service.spec.ts:71` — `increments the counter atomically (ON CONFLICT DO UPDATE, not a read-then-write)`; `:148` (ровно 50 counter-стейтментов, все в одном bucket) |
| 4. Повтор каждого idempotency key возвращает прежний результат | частично | `apps/web/e2e/docflow-register-incoming.spec.ts:59` — `docflow: register-incoming is atomic and idempotent on a client key` (повтор той же команды возвращает тот же `id` и тот же номер); `apps/web/src/features/docflow/components/RegisterWizard.test.tsx:76` — `reuses the same idempotency key on retry, so a lost response cannot double-register` |

**Почему «частично» и что проверить руками**

- **Шаг 4.** Идемпотентность доказана для **одного** ключа в последовательном сценарии. Нагрузочный
  тест `apps/web/e2e/docflow-acceptance.spec.ts:69` использует `POST /documents/:id/actions/register`,
  где idempotency-ключа нет вовсе, — то есть «повтор каждого из 50 ключей» не проверяется, и
  конкурентный replay (два одновременных запроса с одним ключом) тоже.
  *Ручная проверка / доработка:* повторить нагрузочный прогон на `register-incoming` с 50 разными
  ключами, затем повторить все 50 команд ещё раз и убедиться, что ни один новый номер не выдан, а
  ответы совпадают с первыми по `id` и `regNumber`.

---

## Итог по сценариям

| Сценарий | Шагов | да | частично | нет | Вывод |
|---|---|---|---|---|---|
| AC-SED-01. Входящий с ранним ознакомлением | 9 | 2 | 6 | 1 | частично покрыто |
| AC-SED-02. Входящий с таймаутом | 6 | 1 | 5 | 0 | частично покрыто (ключевой спек — opt-in) |
| AC-SED-03. Исходящий ответ | 8 | 5 | 3 | 0 | частично покрыто |
| AC-SED-04. Возврат на доработку | 5 | 5 | 0 | 0 | покрыто полностью |
| AC-SED-05. Архив и hold | 7 | 2 | 5 | 0 | частично покрыто |
| AC-SED-06. Конфиденциальность | 5 | 1 | 3 | 1 | частично покрыто |
| AC-SED-07. Нагрузка регистрации | 4 | 3 | 1 | 0 | частично покрыто (близко к полному) |
| **Итого** | **44** | **19** | **23** | **2** | **полностью покрыт автоматически только AC-SED-04** |

Формулировка «частично» здесь не означает «функция не работает»: в большинстве случаев поведение
реализовано и покрыто на уровне чистых функций, но сквозного утверждения именно этого шага в
именно этом сценарии нет. Исключения, где не подтверждено и поведение, вынесены в последний раздел.

---

## Как прогнать

### 0. Предусловия

```bash
docker compose -f infra/docker/compose.dev.yaml up -d   # PostgreSQL+PostGIS, Redis, MinIO, ClamAV
pnpm i
pnpm db:migrate
pnpm db:seed                                            # базовые справочники, роли, журналы
```

### 1. Unit-тесты (всё, что помечено выше как unit)

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Только по ДОУ:

```bash
pnpm --filter @cuks/api exec vitest run src/modules/docflow
pnpm --filter @cuks/web exec vitest run src/features/docflow
pnpm --filter @cuks/shared test
```

### 2. Playwright

```bash
pnpm e2e     # = pnpm --filter @cuks/db seed:e2e && pnpm --filter @cuks/web e2e
```

**`pnpm db:seed:e2e` обязателен перед КАЖДЫМ запуском playwright.** Он пересоздаёт `e2e_admin`
(сбрасывая 2FA в состояние «до регистрации», которое ожидает `global-setup`), `e2e_user`,
`e2e_user2`, `e2e_duty`, `e2e_sughd` и их роли. Если запускать playwright без пересева — `global-setup` не сможет
пройти enrollment, и упадёт весь прогон. Прямая команда:

```bash
pnpm --filter @cuks/db seed:e2e
pnpm --filter @cuks/web exec playwright test docflow-archive
```

**Throttle логина.** `/auth/login` ограничен 10 запросами в минуту
(`AUTH_LOGIN_RATE_PER_MINUTE = 10`, `packages/shared/src/constants/index.ts:48`), а
`apps/web/playwright.config.ts:15` включает `fullyParallel: true`. Спеки ДОУ делают `apiLogin`
по нескольку раз каждый, поэтому при параллельном прогоне всего набора часть из них получает
`429`. Для приёмочного прогона ДОУ:

```bash
pnpm --filter @cuks/db seed:e2e
pnpm --filter @cuks/web exec playwright test docflow- --workers=1
```

**Воркер обязателен для файловых спеков.** Блок `webServer` в
`apps/web/playwright.config.ts:46` поднимает только api и web; вердикт антивируса даёт BullMQ-джоб `av-scan` в воркере. Без него
`docflow-files.spec.ts` и все проверки скачивания тела корректно зависнут в ожидании
`avStatus=clean`:

```bash
pnpm --filter @cuks/worker dev     # в отдельном терминале
```

### 3. Отдельно: сценарий AC-SED-02 (таймаут gate)

По умолчанию спек пропускается. Нужен API, поднятый с укороченным окном ознакомления, и флаг:

```bash
# терминал 1 — API с gate ≈ 18 секунд вместо 4 часов
DOCFLOW_ACQUAINTANCE_GATE_HOURS=0.005 pnpm --filter @cuks/api dev

# терминал 2
pnpm --filter @cuks/db seed:e2e
GATE_TIMEOUT_E2E=1 pnpm --filter @cuks/web exec playwright test docflow-acquaintance-timeout
```

Спек ждёт до 150 секунд: sweep-проход в
`apps/api/src/modules/docflow/acquaintance-gate.service.ts` идёт раз в 60 секунд.

### 4. Что зафиксировать в протоколе приёмки

- версию/коммит, на котором прогоняли;
- вывод `pnpm typecheck && pnpm lint && pnpm test`;
- отчёт playwright (при `CI=1` пишется HTML-репорт);
- отдельной строкой — прогонялся ли `docflow-acquaintance-timeout` (без него AC-SED-02
  автоматически не подтверждён);
- результаты ручных проверок из списка ниже.

---

## Не покрыто автоматически

Список того, что приёмщик обязан проверить руками или что требует доработки. Разделено по природе
пробела.

### A. Не проверено тестами, но реализовано в коде

1. **Регистрация входящего с реально приложенным PDF** (AC-SED-01.1). Тестируется только путь
   отказа. Проверить в мастере «Зарегистрировать входящий».
2. **Соисполнители в проекте резолюции** (AC-SED-01.4). `coExecutorIds` не участвует ни в одном
   тесте; поле есть в DTO и в схеме.
3. **Уведомление о назначенном поручении** (AC-SED-01.8). Ни факт уведомления исполнителя, ни
   дедупликация «одно уведомление на исполнителя» не проверены. Покрытие уведомлений в модуле
   выборочное: есть тесты на отклонение маршрута (`docflow.document.route_rejected`, AC-SED-04.3)
   и на напоминания о сроках (`docflow-deadline-outbox.service.spec.ts`) — на выдачу поручения нет.
4. **История/audit сквозного сценария** (AC-SED-01.9, AC-SED-03.8). Проверено только наличие
   отдельных событий (`docflow.document.created`, `docflow.document.updated`), не полнота ленты.
5. **Логирование чтения тела ДСП-файла** (AC-SED-06.4). Код пишет запись при download и preview;
   тест утверждает только, что журнал — массив.
6. **`preview` ДСП-файла под неразрешённым пользователем** (AC-SED-06.3). Эндпоинт проходит тот же
   гейт, что и download, но теста нет.
7. **Socket.IO payload по ДСП** (AC-SED-06.5). По коду payload не содержит темы и текста, но ни
   содержимое кадров, ни отсутствие доставки постороннему не проверены.
8. **Дашборд и счётчики «Требует внимания» относительно ДСП** (AC-SED-06.2).
9. **Однократность выпуска gate несколькими инстансами API** (AC-SED-02.3). Обеспечено предикатом
   `released_at is null`; `AcquaintanceGateService` не имеет unit-теста.
10. **Кандидаты к выбытию после истечения срока** (AC-SED-05.4) — недостижимо в e2e из-за
    минимального срока хранения в один месяц.
11. **UI-блокировка выбытия документа под legal hold** (AC-SED-05.6) — доказана только блокировка
    на уровне API.
12. **Полный акт о выделении после снятия hold** (AC-SED-05.7) — доказана только state-машина.
13. **Идемпотентность под конкуренцией** (AC-SED-07.4) — повтор ключа проверен последовательно и
    для одного ключа.
14. **Timing oracle** (AC-SED-06.3) — сравнения времени ответа «ДСП» и «несуществующий id» нет.
15. **Отсутствие документа в кандидатах, пока жив срок** (AC-SED-05.3) — доказано чистой функцией
    `isDispositionCandidate` и отказом 422 на пути внесения в акт. Выборка `candidatesOnly` в e2e
    не проверяется: она фильтрует по флагу `disposition_status`, который проставляет только
    sweep-проход, поэтому утверждение «свежеподшитого документа нет среди кандидатов» не может
    упасть и в покрытие не засчитано.
16. **Календарь Душанбе в номере** (AC-SED-01.2) — граничные случаи (последние часы 31 декабря,
    смена месяца, високосный год) доказаны только unit-тестами с поддельной транзакцией; e2e
    утверждает лишь формат номера.
17. **Сниппет ДСП-документа в поиске** (AC-SED-06.3) — прямой assert
    (`apps/web/e2e/docflow-search.spec.ts:154`) сравнивает регистры и не может обнаружить утечку;
    свойство держится косвенно. Требуется правка теста.

### B. Пробелы реализации, а не тестов

18. **Роли «архивариус» не существует.** `docflow.archive.hold` и `docflow.archive.dispose` есть
    только в шаблоне `chief`. AC-SED-05.5 в текущей конфигурации выполняет руководитель либо
    суперадмин. Требуется решение: вводить ли отдельный шаблон роли.

### C. Ограничения тестового стенда

19. **Разделение обязанностей в сквозных сценариях не доказано.** Регистратор, руководитель,
    подписант и архивариус в e2e — это один `e2e_admin` с wildcard-правами. Отказы по правам
    проверяются точечно (403 на `register-incoming` без `docflow.register`, отсутствие очередей у
    сотрудника без прав), но «правильный актор выполняет правильный шаг» — нет.
    *Приёмка:* пройти AC-SED-01 и AC-SED-03 руками под четырьмя разными учётными записями с
    ролями `clerk`, `chief`, `employee`.
20. **AC-SED-02 в стандартном прогоне не проверяется** — спек opt-in (нужны
    `DOCFLOW_ACQUAINTANCE_GATE_HOURS` и `GATE_TIMEOUT_E2E`).
21. **Файловые спеки требуют запущенного воркера**; без него они падают по таймауту ожидания
    вердикта антивируса, и это не дефект продукта.
22. **Параллельный прогон упирается в throttle логина** (10/мин); приёмочный прогон ДОУ следует
    запускать с `--workers=1`.
