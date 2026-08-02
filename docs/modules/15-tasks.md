# Модуль 15. Задачи (Trello/Jira-lite)

Канбан-доски проектов + единый список «Мои задачи». Просто как Trello, с нужным минимумом от Jira: приоритеты, сроки, чеклисты, связи, фильтры. Без спринтов/стори-поинтов/воркфлоу-конструкторов.

## 1. Права
`tasks.use` (все) · `tasks.projects.create`. Роли в проекте (ACL): owner / editor (создание/правка карточек) / viewer. Видимость проекта: участники + опция «виден подразделению».

## 2. Модель данных (`app`)
**task_projects**: name, key (короткий код `ОПЕР`, для номеров карточек `ОПЕР-142`), description, org_unit_id null, is_archived, created_by. **task_columns**: project_id, name, order, wip_limit null, is_done_column bool. **tasks**: project_id, column_id, seq int (номер в проекте), title, description (TipTap JSON), assignee_ids uuid[] (обычно 1), watcher_ids uuid[], author_id, priority `p1|p2|p3|p4` (по умолчанию p3), due_at null, start_at null, labels uuid[] → **task_labels** (project_id, name, color из палитры токенов), order_in_column (fractional index), completed_at, archived_at, FTS(title+description). **task_checklist_items**: task_id, text, is_done, order. Вложения — files (space=system), комментарии — общая `comments`, связи — `entity_links`, активность — **task_activity** (task_id, actor, action, meta) для истории карточки.

## 3. Доска (`/app/tasks/projects/:projectKey`)
- Колонки с dnd (dnd-kit): карточки и колонки перетаскиваются; fractional index — без каскадных апдейтов. WIP-лимит превышен → колонка подсвечена warning.
- Карточка на доске: приоритет-полоска слева (цвет p1 danger → p4 muted), номер, заголовок, бейджи: срок (цвет по близости), аватары исполнителей, счётчики чеклиста/комментариев/вложений, метки-точки.
- Тулбар доски: фильтры (исполнитель, метка, приоритет, срок, текст), «только мои», группировка по исполнителю (swimlanes v2 — нет, просто фильтр), поиск, вид Доска/Список (список = DataTable тех же карточек), архив карточек.
- Realtime: комната `board:{projectId}` — `tasks.card.created|updated|moved`, конфликт перетаскивания разрешается last-write + плавная анимация чужих перемещений.

## 4. Карточка задачи
Открывается SidePanel-ом поверх доски (URL `/app/tasks/projects/:projectKey/:seq`). Содержимое: заголовок (inline-edit), статус-колонка (селект), описание (rich), исполнители (UserPicker), срок (DateTimeField, быстрые «завтра/неделя»), приоритет, метки, чеклист (прогресс-бар, dnd, конверт пункта в задачу), вложения, связи (`entity_links`), комментарии (упоминания шлют уведомления), вкладка «История». Кнопки: Завершить (в done-колонку), Подписаться, Копировать, Архивировать.

**Цели связи — только ЧС и документ**: `TASK_LINK_TARGETS = ['incident', 'document']` (`packages/shared/src/enums/index.ts`), и DTO валидируют ровно этот перечень. Общий `LINK_ENTITY_TYPES` всё ещё содержит `channel`, но ни один эндпоинт задач его не принимает — связей задача↔канал и задача↔сообщение **не реализовано**.

**Шаблоны карточек** проекта: предзаполненные title/описание/чеклист (например «Отработка донесения о ЧС» — типовой чеклист дежурного). Создание карточки из шаблона — в меню «+».

## 5. Мои задачи (`/app/tasks`)
Агрегат по всем проектам: группы «Просрочено / Сегодня / Эта неделя / Позже / Без срока», строка = карточка (проект-бейдж, приоритет, срок). Быстрое завершение чекбоксом. Фильтр «где я наблюдатель». Счётчик просроченных — бейдж в сайдбаре приложения. Виджет «Мои задачи» на дашборде — те же данные, топ-5.

## 6. Создание задач из других модулей

Кнопка «Создать задачу» — в карточке ЧС и в карточке документа (вкладка «Задачи»). Обе поверхности используют один и тот же компонент `LinkedTasksSection` (`apps/web/src/features/tasks/components/LinkedTasksSection.tsx`), поэтому связь видна с обеих сторон. Диалог мини-формы: проект, колонка, заголовок, исполнители, срок; карточка создаётся и связывается одним запросом (`POST /tasks/cards/linked`). Создания задачи из сообщения чата **нет** (см. §11).

**Из документа задача создаётся вручную.** Резолюция (поручение) — отдельный механизм ДОУ: «Мои поручения» считаются по таблице `resolutions` (`apps/api/src/modules/docflow/resolutions.service.ts`), модуль ДОУ ничего не пишет ни в `tasks`, ни в `entity_links`. Это зафиксированное решение: вкладка «Задачи» карточки документа работает через общие `entity_links`, а резолюции сохраняют свой путь, чтобы не дублировать логику задач. Подробности — `docs/modules/11-docflow.md`.

### 6.1. Граница ДСП для связей

Правило неочевидное и держится на **содержимом связи**, а не на проверке видимости:

- создание связи проверяет только, что целевой документ существует и не удалён (`EntityLinksService.requireTarget`, `apps/api/src/modules/tasks/entity-links.service.ts`); **видимость документа при этом не проверяется** — редактор проекта может связать карточку с документом, который сам открыть не сможет;
- защищена вместо этого **полезная нагрузка**: разрешённая связь несёт только номер — `ЧС <number>` или регистрационный номер документа, `subtitle` всегда `null`, тема документа не попадает в связь никогда; карточка документа предзаполняет заголовок новой задачи **только** `regNumber` (в `DocumentCardPage.tsx` это снабжено отдельным комментарием в коде: заголовок карточки виден участникам проекта, которые могут не иметь доступа к документу). Для ЧС предзаполняется номер и вид ЧС — там грифа нет;
- `GET /tasks/linked/:targetType/:targetId` скоупится **членством вызывающего в проектах задач**, а не видимостью документа;
- открытие самой связанной сущности идёт через политику её модуля — ссылка ведёт на карточку, доступ к карточке решает ДОУ/ЧС.

Записано явно, чтобы будущее «улучшение» заголовка связи до темы документа не превратилось в утечку ДСП.

## 7. Уведомления
Назначение исполнителем, упоминание в комментарии, смена статуса наблюдаемой, срок (за 1 день и в день, worker deadlines), просрочка (исполнителю+автору). Digest «задачи на сегодня» — утренний email (opt-in).

## 8. API (основное)

Всё под правом `tasks.use`, **кроме `POST /tasks/projects`** — создание проекта требует `tasks.projects.create` (§1). У `projects.controller.ts` нет классового `@RequirePermission`: право объявлено на каждом методе, и только у `create` оно другое. Остальные четыре контроллера — под `tasks.use`. Всего пять контроллеров в `apps/api/src/modules/tasks/`.

**Проекты** (`projects.controller.ts`):
```
GET/POST /tasks/projects   GET /tasks/projects/by-key/:key   GET/PATCH /tasks/projects/:id
POST /tasks/projects/:id/archive
GET/POST /tasks/projects/:id/members   DELETE /tasks/projects/:id/members/:userId
```

**Доска, колонки, метки, шаблоны** (`board.controller.ts`, префикс `/tasks/projects/:projectId`):
```
GET  /tasks/projects/:projectId/board            (полная доска одним запросом)
POST /tasks/projects/:projectId/cards            (создание карточки)
POST /tasks/projects/:projectId/columns   PATCH /tasks/projects/:projectId/columns/:columnId
POST /tasks/projects/:projectId/columns/:columnId/move   DELETE .../columns/:columnId
GET/POST /tasks/projects/:projectId/labels
GET/POST /tasks/projects/:projectId/templates    DELETE .../templates/:templateId
POST /tasks/projects/:projectId/templates/:templateId/card
```

**Карточка** (`cards.controller.ts`, префикс `/tasks/cards`):
```
GET/PATCH /tasks/cards/:id
POST /tasks/cards/:id/{move,complete,copy,archive,watch}   DELETE /tasks/cards/:id/watch
POST /tasks/cards/:id/checklist   PATCH|DELETE /tasks/cards/:id/checklist/:itemId
GET/POST /tasks/cards/:id/comments   DELETE /tasks/cards/:id/comments/:commentId
GET /tasks/cards/:id/activity
GET/POST /tasks/cards/:id/links   DELETE /tasks/cards/:id/links/:linkId
```

**Мои задачи** (`my-tasks.controller.ts`) и **связи с другими модулями** (`task-links.controller.ts`):
```
GET /tasks/my?watching   GET /tasks/my/overdue-count
POST /tasks/cards/linked                    (создать карточку сразу со связью на ЧС/документ)
GET  /tasks/linked/:targetType/:targetId    (задачи, связанные с этой сущностью — для её карточки)
```

Чего **нет**: `GET /tasks/search` (глобального поиска по задачам не реализовано — поиск живёт в фильтрах доски), `POST /tasks` (создание — только в контексте проекта), параметра `group` у `GET /tasks/my` (группировка «Просрочено / Сегодня / …» из §5 считается на клиенте).

## 9. Аудит
`tasks.project.created`, `tasks.template.created`, `tasks.card.created/updated/moved/completed/assigned/commented/linked/unlinked` (+ вся история в task_activity). `tasks.card.linked` пишется и в аудит, и в историю карточки, с `meta: {targetType, targetId}`, причём повторная установка уже существующей связи идемпотентна и след не пачкает; `tasks.card.unlinked` — только в аудит и без meta.

## 10. Критерии приёмки
- Dnd плавный при 200 карточках на доске; два клиента видят перемещения друг друга < 500 мс.
- «Мои задачи» собирает карточки из всех проектов, просрочка подсвечена, бейдж в сайдбаре совпадает.
- Задача из карточки ЧС создаётся со связью, связь видна с обеих сторон.
- Viewer не может двигать карточки (UI скрыт + e2e 403).
- Напоминание о сроке приходит (фейк-таймер тест).

## 11. V2+
Спринты, гант/календарь, повторяющиеся задачи (график дежурств), автоматизации-правила, оценки времени, создание задачи из сообщения чата (текст → заголовок, связь на сообщение) и связи задача↔канал.
