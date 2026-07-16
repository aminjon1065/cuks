# Установка CUKS «с нуля» — runbook администратора

Пошаговая установка платформы на один сервер (docs/08-deployment.md, задача 7.1). Всё — контейнеры Docker
Compose на одном хосте; наружу смотрят только Caddy (80/443) и медиапорты LiveKit. Ориентировочное время
первой установки — 30–60 минут (без учёта сборки образов).

## 1. Требования к серверу

- **ОС**: Ubuntu Server 24.04 LTS (рекомендовано), x86-64.
- **Ресурсы**: минимум 8 vCPU / 32 ГБ / 1 ТБ NVMe; рекомендуемо 16 vCPU / 64 ГБ / 2 ТБ NVMe + HDD под
  бэкапы и записи (docs/08 §Требования). Одна параллельная запись конференции ≈ 2–3 vCPU.
- **Софт**: Docker Engine ≥ 26 с плагином `docker compose` v2. Проверка: `docker compose version`.
- **Домен и DNS**: A/AAAA-записи для `<домен>` **и** `s3.<домен>` указывают на этот сервер (нужно ещё до
  первого запуска — Caddy выпускает Let's Encrypt для обоих). Для полностью закрытой сети см. §7 (вариант 2).

## 2. Файрвол

Открыть наружу только:

| Порт | Назначение |
|---|---|
| 80/tcp | HTTP → редирект на HTTPS (и ACME-челлендж Let's Encrypt) |
| 443/tcp | Приложение (HTTPS, WSS, presigned S3 на поддомене) |
| 7881/tcp | LiveKit ICE/TCP fallback |
| 7882/udp | LiveKit media (UDP-mux, основной путь медиа) — **обязательно** |
| 5349/tcp | *(опц.)* встроенный TURN LiveKit для строгих NAT — только если включаете TURN (§8) |
| 5432/tcp | *(опц.)* QGIS→PostGIS — **только** из VPN/allowlist ГИС-аналитиков, никогда в открытый интернет |

Всё остальное (postgres, redis, minio, geoserver, martin, egress, clamav) живёт во внутренней docker-сети
и наружу не публикуется.

## 3. Получить код

```bash
git clone <repo-url> cuks && cd cuks
git checkout <release-tag>     # или main
```

## 4. Секреты и `.env`

```bash
cp .env.prod.example .env
chmod 600 .env
```

Сгенерировать сильные значения и вписать вместо всех `CHANGE_ME…`:

```bash
openssl rand -base64 48   # для SESSION_SECRET, ENCRYPTION_KEY, LIVEKIT_API_SECRET (каждому — своё)
openssl rand -hex 24      # для POSTGRES_PASSWORD и прочих паролей (S3, GeoServer, gis_reader)
```

**Важно:** для `POSTGRES_PASSWORD` берите `openssl rand -hex …` (или иной URL-safe набор), **не** `base64`.
Этот пароль встраивается в `DATABASE_URL` и в строку подключения Martin — символ `/` из base64 ломает разбор
URL, и api/worker/Martin не подключатся к БД. Hex-значения (`0-9a-f`) безопасны и в URL, и в psql, и в env.

Обязательно проверьте согласованность (файлы `.env` не подставляют переменные друг в друга):

- `CUKS_DOMAIN`, `APP_ORIGIN` (`https://<домен>`) и `S3_PUBLIC_ENDPOINT` (`https://s3.<домен>`) — один домен.
- `POSTGRES_PASSWORD` совпадает с паролем внутри `DATABASE_URL` и не содержит URL-спецсимволов (`/ @ : ?`).
- `LIVEKIT_API_KEY=cuks` (имя ключа не менять — на него завязаны `livekit.prod.yaml` и egress).

Все команды `docker compose` ниже запускаются **из корня репозитория** с явным `--env-file .env`, потому что
один и тот же `.env` кормит и подстановку `${…}` в compose, и контейнеры (`env_file`). Удобно завести алиас:

```bash
alias dc='docker compose --env-file .env -f infra/docker/compose.prod.yaml'
```

## 5. Сборка образов

```bash
dc build
```

Собирается один build-слой (весь monorepo, `pnpm build`), из него — образы `api`, `worker`, `caddy` (в
последний вшивается собранный SPA). Первая сборка — 5–15 минут.

## 6. Инициализация БД и первый запуск

Поднять сначала данные-сервисы, дождаться healthy, применить миграции и сиды, затем поднять остальное:

```bash
# 1) Данные-сервисы
dc up -d postgres redis minio
dc ps                     # дождаться (health: healthy) у postgres/redis/minio

# 2) Роль только-на-чтение для GeoServer (docs/09 §Права PG). Пароль — из GEOSERVER_PG_PASSWORD в .env.
dc exec -T postgres psql -U cuks -d cuks -c \
  "CREATE ROLE gis_reader LOGIN PASSWORD 'CHANGE_ME_gis_reader_password'; GRANT USAGE ON SCHEMA public TO gis_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO gis_reader; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO gis_reader;"

# 3) Миграции (ДО старта api) и сиды (админ + справочники)
dc run --rm api pnpm db:migrate
dc run --rm api pnpm db:seed

# 4) Остальной стек
dc up -d

# 5) Martin кэширует каталог слоёв на старте — перечитать после сидов, иначе на карте нет слоёв
dc restart martin
```

Проверить, что всё поднялось: `dc ps` (все `running`/`healthy`), логи api — `dc logs -f api`.

## 7. TLS — два сценария (docs/08 §TLS)

**Вариант 1 — публичный домен (рекомендуемый).** Ничего делать не нужно: при `CUKS_TLS_INTERNAL=` (пусто)
Caddy автоматически получает Let's Encrypt для `<домен>` и `s3.<домен>`. Требуется доступность 80/443 снаружи
и корректные DNS-записи (§1).

**Вариант 2 — полностью закрытая сеть.** В `.env` задать `CUKS_TLS_INTERNAL=tls internal` — Caddy выпустит
собственный CA. Корневой сертификат нужно установить на все рабочие станции:

```bash
dc exec caddy caddy trust                      # или забрать /data/caddy/pki/authorities/local/root.crt
```

Раздать `root.crt` через групповую политику/вручную (иначе не заработают WebRTC, WebCrypto, Secure-cookie).

## 8. TURN для строгих сетей (опционально)

По умолчанию встроенный TURN выключен — при открытом 7882/udp прямой ICE работает у большинства клиентов.
Если часть участников за жёстким NAT/файрволом и звонки не соединяются, включите TURN: в
`infra/docker/livekit/livekit.prod.yaml` выставьте `turn.enabled: true`, `domain: <домен>`, обеспечьте TLS-
сертификат для `:5349` (`external_tls` терминирует TLS на границе — нужен layer4-маршрут, например сборка
caddy-l4), раскомментируйте порт `5349:5349` в compose и откройте 5349/tcp на файрволе.

## 9. Первый вход

1. Открыть `https://<домен>`, войти как `admin` с паролем `SEED_ADMIN_PASSWORD`.
2. Система потребует сменить пароль и включить 2FA (TOTP) — это обязательный шаг для привилегированных ролей.
3. Далее завести оргструктуру и пользователей согласно руководству администратора.

GeoServer-админка (если нужна) — `https://<домен>/geoserver`, логин `admin` / `GEOSERVER_ADMIN_PASSWORD`.

## 10. Проверка установки (smoke)

- `curl -fsS https://<домен>/api/health` → `{ ok: true }` (liveness); `/api/health/ready` → все зависимости `up`.
- Карта в приложении открывается и показывает базовые слои (если нет — см. `dc restart martin`, §6.5).
- Загрузка файла и его скачивание работают (проверяет цепочку MinIO + presigned на `s3.<домен>`).
- Тестовый звонок 1:1 между двумя пользователями соединяется; запись стартует и потом воспроизводится.

## 11. Обновление приложения (docs/08 §Обновление)

```bash
git pull
dc build api worker caddy
dc run --rm api pnpm db:migrate     # миграции ДО перезапуска
dc up -d api worker caddy
```

Миграции в пределах релиза держим backward-compatible, где возможно. Никогда не редактировать уже
применённые миграции — только новые (CLAUDE.md §2).

## 12. Бэкапы

Сервис `backup` в compose.prod уже делает ночной локальный слепок volume'ов (pgdata, miniodata,
geoserverdata, ca) в volume `backupdata`. Полноценный restic-репозиторий, расписание и **restore-drill**
настраиваются в задаче 7.2 (docs/08 §Бэкапы). Бэкап без проверенного восстановления бэкапом не считается.
