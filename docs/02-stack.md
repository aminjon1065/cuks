# 02. Технологический стек и решения (ADR)

## Зафиксированные версии

| Слой | Выбор | Версия (на старте) |
|---|---|---|
| Runtime | Node.js | 22 LTS |
| Язык | TypeScript strict | 5.x |
| Монорепо | pnpm workspaces + Turborepo | pnpm 9, turbo 2 |
| Backend | NestJS + Fastify adapter | 11 |
| ORM | Drizzle ORM + drizzle-kit, драйвер `pg` | latest stable |
| БД | PostgreSQL + PostGIS (образ `postgis/postgis:17-3.5`) | 17 / 3.5 |
| Кэш/очереди | Redis + BullMQ | 7 / 5 |
| Realtime | Socket.IO (+ redis-adapter) | 4 |
| Хранилище | MinIO + AWS SDK v3 (S3-клиент) | latest |
| Видео | LiveKit server + Egress, `livekit-client`, `@livekit/components-react` | latest |
| Тайлы | Martin (векторные MVT + PMTiles) | latest |
| OGC | GeoServer | 2.26+ |
| Геообработка | GDAL/ogr2ogr (в образе worker) | 3.x |
| Frontend | React + Vite | 19 / 6 |
| Роутинг | React Router (library mode) | 7 |
| Данные на фронте | TanStack Query 5 + Zustand (локальный UI-стейт) | — |
| Формы | react-hook-form + zod | — |
| UI | shadcn/ui + Tailwind CSS 4 + lucide-react | — |
| Карта | MapLibre GL JS + terra-draw + turf.js | 5 / — |
| Графики | Apache ECharts | 5 |
| i18n | i18next + react-i18next | — |
| Даты | date-fns + date-fns-tz | — |
| Права | CASL (общие ability в packages/shared) | 6 |
| Валидация API | zod + nestjs-zod (DTO + OpenAPI) | — |
| Документация API | @nestjs/swagger | — |
| Тесты | Vitest, Testing Library, supertest, Playwright | — |
| Качество | ESLint 9 flat + Prettier + husky + lint-staged + commitlint | — |
| Email | Nodemailer → корпоративный SMTP | — |
| PDF (штампы ЭЦП) | pdf-lib | — |
| XLSX (отчёты) | exceljs | — |
| Изображения | sharp | — |
| Логи | pino + pino-http | — |
| Пароли | argon2 (argon2id) | — |
| Прокси/TLS | Caddy | 2 |

## ADR — ключевые решения и почему

| # | Решение | Альтернативы | Обоснование |
|---|---|---|---|
| 1 | **SPA (Vite+React), не Next.js** | Next.js | Внутренняя система без SEO; карты/чат/звонки — клиентские; статика + один API проще в эксплуатации и для агента; нет второго рантайма |
| 2 | **Drizzle, не Prisma/TypeORM** | Prisma | PostGIS-типы и сырой SQL первосортны в Drizzle; Prisma для geometry требует `Unsupported` и $queryRaw; drizzle-kit миграции — обычный SQL, читаемый и правимый |
| 3 | **Серверные сессии (Redis), не JWT** | JWT access/refresh | Мгновенный отзыв сессий (требование безопасности госоргана), проще ротация, нет проблем хранения токенов в браузере. httpOnly+Secure+SameSite=Lax cookie |
| 4 | **Socket.IO, не raw WebSocket** | ws, SSE | Комнаты, reconnect, fallback, redis-adapter из коробки; интеграция с Nest зрелая |
| 5 | **LiveKit, не Jitsi/mediasoup** | Jitsi, mediasoup | SFU промышленного уровня, свой UI на React SDK, Egress-запись в S3, симулкаст, TURN встроен. Jitsi — чужой UI, слабая интеграция; mediasoup — месяцы разработки |
| 6 | **MinIO, не файловая система** | FS | Presigned URL разгружают api, версии/lifecycle из коробки, единый механизм для 5 модулей, простое резервирование (mirror) |
| 7 | **Martin + GeoServer вместе** | только GeoServer | Martin — быстрые MVT для веба без конфигурации; GeoServer — стандарт OGC для QGIS/ArcGIS. Каждый делает своё |
| 8 | **PG FTS, не Elasticsearch** | Elastic/Meilisearch | Ещё один сервис с JVM не оправдан для ≤1М документов; `russian`-конфигурация покрывает нужды. Пересмотр — если поиск станет узким местом |
| 9 | **ECharts, не Recharts** | Recharts, Chart.js | Дашборды серьёзные: heatmap, комбинированные оси, большие ряды, канвас-производительность, экспорт PNG |
| 10 | **Caddy, не nginx** | nginx | Авто-TLS (Let's Encrypt или внутренний CA), конфиг в 10 строк, меньше ошибок эксплуатации |
| 11 | **BullMQ, не RabbitMQ/Kafka** | RabbitMQ | Redis уже есть; надёжности BullMQ достаточно; нет нового сервиса |
| 12 | **PMTiles-подложка (Protomaps), не OSM-тайлы онлайн** | tile.openstreetmap.org | Работает без интернета, один файл ~1–2 ГБ на регион, нет зависимости от внешних серверов и их политик |
| 13 | **Внутренний УЦ для ЭЦП (WebCrypto ECDSA P-256)** | гос. УЦ сразу | Нет зависимости от внешних API/токенов; юридически — внутренняя подпись организации; архитектура допускает добавление гос-ЭЦП этапом 2 (см. 09-security) |
| 14 | **UUIDv7** | serial, uuid4 | Сортируемость по времени (индексы), безопасность (непредсказуемость), генерация на клиенте возможна |
| 15 | **pnpm + Turborepo** | npm/yarn, Nx | Экономия диска, строгие node_modules; turbo — простые пайплайны кэшируемых задач без магии Nx |

## Политика зависимостей

- Новая зависимость = запись в `docs/plan/STATUS.md` (что, зачем, размер, альтернативы).
- Запрещены: пакеты без поддержки >18 мес, дублирующие уже принятые (второй HTTP-клиент, вторая библиотека дат), lodash целиком (только `es-toolkit` при нужде).
- Все версии фиксируются в lockfile; обновления — осознанные, пакетами, с прогоном тестов.
