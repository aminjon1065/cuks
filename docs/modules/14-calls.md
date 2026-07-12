# Модуль 14. Аудио/видеозвонки и конференции

WebRTC-конференции на self-hosted LiveKit: звонки из чата, запланированные совещания, демонстрация экрана, запись в хранилище. UI — собственный (React поверх `@livekit/components-react`), в стиле дизайн-системы.

## 1. Права
`meet.use` (все) · `meet.record` (запуск записи) · `meet.recordings.manage` (все записи). В комнате: host (создатель/назначенный) — mute-all, удаление участника, завершение для всех, запись; participant.

## 2. Сценарии

- **Звонок 1:1 из DM**: кнопка 📞/📹 → ring-событие получателю (WS `meet.ring` + пуш-уведомление + мелодия): принять/отклонить. 30 сек без ответа → «пропущенный» (системное сообщение в DM).
- **Звонок в канале**: кнопка в шапке → в канале появляется баннер-карточка «Идёт звонок, N участников [Присоединиться]» (без ринга каждому; упоминание @channel опционально при старте).
- **Совещание по ссылке**: «Новая встреча» → комната с постоянной ссылкой `/app/meet/r/{slug}`, доступ: участники платформы по ссылке / только приглашённые (лобби: host впускает).
- **Запланированное совещание**: форма (тема, дата/время, длительность, участники/подразделения, повестка-текст, флаг записи) → уведомления при создании и за 15 мин → карточка встречи со ссылкой. Список «Встречи» — сегодня/предстоящие/прошедшие. (Полноценный календарь — v2, здесь простой список.)

## 3. Комната звонка (UI)

- **Пре-джойн экран**: превью камеры, выбор устройств (камера/микрофон/динамики), тест микрофона (индикатор уровня), состояние «вход без камеры/микрофона».
- Сетка: авто-layout (1–2 — крупно, далее грид до 5×5, пагинация); режим «докладчик» (активный спикер крупно); закрепление участника.
- Демонстрация экрана (вкладка/окно/экран, со звуком вкладки), приоритет screen-share в layout.
- Контролы снизу: mute/unmute (Space push-to-talk удержанием), камера, screen-share, рука ✋, реакции, чат комнаты (LiveKit data channel, эфемерный), участники (список + host-действия), запись ●, настройки устройств, выход. Индикаторы: качество соединения per-участник, «говорит» — рамка.
- Host: mute участника (без unmute), удалить, «выключить всем микрофоны», передать host, завершить встречу для всех.
- Плохая сеть: adaptive simulcast (LiveKit), авто-переход в audio-only с уведомлением, кнопка «отключить входящее видео».
- Пиктограмма записи видна ВСЕМ + системное объявление при старте/остановке (требование).

## 4. Запись
- Host с правом `meet.record`: старт/стоп. LiveKit Egress (room composite, 1080p, спикер-layout) → MP4 в MinIO bucket `recordings` → webhook → карточка записи: **recordings**: room_id, meeting_id null, title, started_by, duration, size, file_key, participants uuid[], status `processing|ready|failed`.
- Доступ к записи: участники встречи + `meet.recordings.manage`; шаринг — через ACL (как файлы). Страница «Записи»: список с плеером (стриминг range), скачивание (аудит), удаление (host/manage). Retention — конфиг (по умолчанию 180 дней, предупреждение за 14).
- Параллельных записей ≤ 2 (конфиг, очередь с сообщением «запись начнётся после освобождения слота»).

## 5. Модель данных (`app`)
**meet_rooms**: slug uq, kind `dm|channel|adhoc|meeting`, channel_id null, created_by, access `link|invited`, is_active, livekit_room (имя). **meetings**: room_id, title, agenda, starts_at, duration_min, organizer_id, participants (users/org_units jsonb), record_planned, status `scheduled|live|done|cancelled`. **meet_calls** (история звонков): room_id, started_at, ended_at, initiator_id, participants uuid[], max_concurrent. **recordings** — выше.

## 6. Интеграция с LiveKit
- api — единственный источник токенов: `POST /meet/rooms/:id/token` → проверка прав → LiveKit AccessToken (identity=user_id, name, metadata: avatar, роль; grants по роли; TTL 10 мин).
- Webhooks LiveKit → api: participant joined/left (лента, meet_calls), room finished, egress ended (запись готова).
- Сервер LiveKit/Egress — конфиги в `infra/docker/livekit/`. TURN встроенный (tls:5349) для строгих сетей.

## 7. API (основное)
```
POST /meet/rooms {kind, channelId?}  GET /meet/rooms/:slug  POST /meet/rooms/:id/token
POST /meet/ring {userId, roomId}  POST /meet/ring/:id/{accept|decline}
GET/POST /meet/meetings  PATCH /meet/meetings/:id  GET /meet/meetings?range=today|upcoming|past
POST /meet/rooms/:id/recording/{start|stop}  GET /meet/recordings  GET /meet/recordings/:id(/download)
DELETE /meet/recordings/:id  GET /meet/history (мои звонки)
```
WS: `meet.ring`, `meet.ring.cancelled`, `meet.room.updated` (участники для баннера канала), `meet.recording.state`.

## 8. Sizing (для 08-deployment)
| Сценарий | CPU LiveKit | Прим. |
|---|---|---|
| 10 × звонков 1:1 | ~1 vCPU | — |
| Конференция 25 чел. | ~2 vCPU | simulcast |
| Конференция 100 чел. (10 видео + зрители) | ~4 vCPU | принудительный audio-only зрителям |
| 1 запись Egress | +2–3 vCPU | лимит параллельных |

## 9. Критерии приёмки
- 1:1 звонок из DM: ring, принятие, видео/аудио двусторонне, длительность в системном сообщении.
- Конференция 8+ участников с 2 screen-share стабильна ≥ 30 мин; отвал сети 10 с → авто-reconnect.
- Запись: файл появляется в «Записях», играет в браузере, доступен только участникам (e2e 403).
- Работа через TURN: клиент за «жёстким» NAT (эмуляция блокировкой UDP) соединяется по tls:5349.
- Пре-джойн корректно работает без камеры (только аудио) и без обоих устройств (зритель).

## 10. V2+
Календарь с занятостью, трансляции (webinar), стенограммы (whisper on-prem), виртуальные фоны, SIP-шлюз для телефонии.
