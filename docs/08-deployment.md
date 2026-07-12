# 08. Развёртывание и эксплуатация

## Топология: один сервер, Docker Compose

Всё — контейнеры на одном хосте (Ubuntu Server 24.04 LTS рекомендован). Наружу — только Caddy (80/443) и порты LiveKit. БД/Redis/MinIO — только во внутренней docker-сети (плюс опционально 5432 для QGIS, см. ниже).

## Требования к серверу

| Профиль | CPU | RAM | Диск | Комментарий |
|---|---|---|---|---|
| Минимум (до 100 польз., звонки до 20) | 8 vCPU | 32 ГБ | 1 ТБ NVMe | без запаса |
| **Рекомендуемый** (до 500 польз., звонки до 50–100, записи) | 16 vCPU | 64 ГБ | 2 ТБ NVMe + 4 ТБ HDD (бэкапы/записи) | целевой |
| Разнесённый (если появится 2-й сервер) | — | — | — | LiveKit+Egress выносится первым |

Egress (запись) — самый прожорливый: ~2–3 vCPU на одну параллельную запись конференции. Ограничить параллельные записи конфигом (по умолчанию 2).

## Состав compose.prod.yaml

| Сервис | Образ | Порты наружу | Volumes |
|---|---|---|---|
| caddy | caddy:2 | 80, 443 | caddy_data (сертификаты) |
| web | nginx-less: статика внутри caddy ИЛИ отдельный образ | — | сборка web копируется в caddy volume |
| api | cuks/api (Dockerfile) | — | — |
| worker | cuks/worker (+gdal) | — | — |
| postgres | postgis/postgis:17-3.5 | (5432 опц.) | pg_data |
| redis | redis:7-alpine | — | redis_data (AOF) |
| minio | minio/minio | — | minio_data |
| livekit | livekit/livekit-server | 7881/tcp, 50000-50200/udp, (443 turn через caddy — нет: отдельный 5349/tcp) | — |
| egress | livekit/egress | — | shared tmp |
| martin | ghcr.io/maplibre/martin | — | basemap (pmtiles, ro) |
| geoserver | kartoza/geoserver | — | geoserver_data |
| clamav | clamav/clamav | — | clam_db |
| backup | offen/docker-volume-backup или cron+scripts | — | все data-volumes ro |

Все сервисы: `restart: unless-stopped`, healthcheck, `logging: json-file, max-size 50m, max-file 5`. Лимиты памяти явно (`mem_limit`), чтобы один сервис не убил сервер.

## Маршрутизация Caddy

```
cuks.<домен> {
  encode zstd gzip
  handle /api/* { reverse_proxy api:3000 }
  handle /ws/* { reverse_proxy api:3000 }
  handle /tiles/* { reverse_proxy martin:3000 }
  handle /geoserver/* { reverse_proxy geoserver:8080 }
  handle /s3/* { reverse_proxy minio:9000 }        # presigned URL через тот же origin
  handle /livekit/* { reverse_proxy livekit:7880 } # ws-сигналинг
  handle { root * /srv/web  try_files {path} /index.html  file_server }
  header { Strict-Transport-Security "max-age=31536000" X-Content-Type-Options nosniff X-Frame-Options DENY }
}
```

## TLS — два сценария

1. **Есть публичный домен** (даже если сервер за файрволом с открытым 80/443): Caddy получает Let's Encrypt автоматически. Рекомендуемый путь.
2. **Полностью закрытая сеть**: внутренний CA Caddy (`tls internal`) — корневой сертификат Caddy ставится на рабочие станции групповой политикой/вручную. Инструкцию для админа приложить.

Без TLS не работать: WebRTC, WebCrypto, Secure cookies этого требуют.

## Сеть/файрвол

| Порт | Кто | Зачем |
|---|---|---|
| 443/tcp (80 redirect) | все клиенты | приложение |
| 7881/tcp | клиенты | LiveKit ICE/TCP fallback |
| 50000–50200/udp | клиенты | WebRTC media (диапазон сужен конфигом) |
| 5349/tcp (turns) | клиенты | встроенный TURN LiveKit для строгих сетей |
| 5432/tcp | только IP-allowlist ГИС-аналитиков или VPN | QGIS→PostGIS (TLS + scram-sha-256). Рекомендация: WireGuard-контейнер вместо открытого порта |

## Переменные окружения

Матрица dev/prod в `.env.example` с комментарием у каждой. Секреты prod — в `.env` на сервере (chmod 600), не в git. Ключ внутреннего УЦ — файл в docker volume `ca_data`, бэкапится шифрованно.

## Бэкапы (обязательная часть фазы 0/7)

| Что | Как | Когда | Куда |
|---|---|---|---|
| PostgreSQL | `pg_dump -Fc` (все схемы) | ежедневно 02:00 | локальный HDD → restic-репозиторий |
| MinIO | `mc mirror --overwrite` на HDD; критичные бакеты (docflow) — versioning в MinIO | ежедневно | HDD + restic |
| Volumes конфигов (caddy, geoserver, ca) | tar | еженедельно | restic |
| restic-репозиторий | шифрованный, пароль оффлайн у админа | — | HDD + (желательно) внешний диск/второй сервер, ротация 30 дней + 12 месячных |

**Restore drill** — раз в квартал по `infra/scripts/restore.sh` на dev-машине; процедура задокументирована. Бэкап без проверенного восстановления = нет бэкапа.

## Обновление приложения

```bash
git pull && pnpm i && pnpm build
docker compose -f infra/docker/compose.prod.yaml build api worker
docker compose ... run --rm api pnpm db:migrate   # миграции ДО перезапуска
docker compose ... up -d api worker && rsync web/dist → caddy volume
```
Окно обслуживания: вечер; страница «Идёт обновление» отдаётся Caddy, если api down (fallback handle). Миграции — только backward-compatible в рамках одного релиза, если возможно.

## Мониторинг (лайт, без Prometheus-стека в v1)

- Uptime Kuma (контейнер): пинг `/api/health/ready`, LiveKit, GeoServer, место на диске (push-скрипт) → уведомления в канал чата платформы (webhook) и email админу.
- Админ-дашборд «Здоровье» (modules/16): диск, размеры БД/бакетов, очереди BullMQ, ошибки за сутки.
- Опционально фаза 7+: node-exporter+Grafana, GlitchTip для ошибок фронта.

## Dev-окружение

`compose.dev.yaml` — только инфраструктура (pg, redis, minio, livekit-dev, martin, geoserver, clamav, maildev для писем). api/web/worker — локально через `pnpm dev`. Порты dev фиксированы и записаны в .env.example.
