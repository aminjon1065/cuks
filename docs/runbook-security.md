# Безопасность перед продом — runbook

Чеклист docs/09-security.md §7 как выполнимая процедура (задача 7.5). Прогонять перед каждым релизом на прод
и после крупных изменений зависимостей/инфраструктуры.

## 1. Зависимости (`pnpm audit`)

```bash
corepack pnpm audit --prod
```

Должно быть чисто **или** каждый пункт — обоснованное исключение ниже. Текущее состояние (2026-07):

| Пакет | Было | Действие |
|---|---|---|
| drizzle-orm | 0.38.4 (**high**, SQL-injection GHSA-gpj5-g38j-94v9) | обновлён до 0.45.2 — исправлено |
| echarts | 5.6.0 (moderate XSS GHSA-fgmj-fm8m-jvvx) | обновлён до 6.1.0 — исправлено |
| @fastify/static | 8.3.0 (2× moderate: path-traversal, guard-bypass) | **исключение** (см. ниже) |

**Обоснованное исключение — @fastify/static**: единственный потребитель — Swagger UI (`@nestjs/swagger`),
который поднимается **только вне production** (`main.ts`: `if (!config.isProduction)`), поэтому статика
`@fastify/static` в прод-сборке не отдаётся и уязвимость не имеет поверхности атаки на проде. Пересмотреть,
когда Nest подтянет `@fastify/static ≥ 9.1.1` (или если Swagger когда-либо включат на проде).

## 2. Скан образов (trivy)

После `dc build`:

```bash
./infra/security/trivy-scan.sh              # CRITICAL,HIGH по умолчанию
TRIVY_SEVERITY=CRITICAL,HIGH,MEDIUM ./infra/security/trivy-scan.sh
```

Скрипт сканирует собранные образы (`cuks-*`) и закреплённые сторонние. Цель — **без CRITICAL**. Принятые/
неустранимые CVE — в `infra/security/.trivyignore` с комментарием и датой. trivy можно запускать и через docker
(команда в скрипте), если не установлен локально.

## 3. DAST — OWASP ZAP baseline

Против **стейджа** (не прод; baseline = только пассивные правила + паук, без активных атак):

```bash
./infra/security/zap-baseline.sh https://staging.<домен>
```

Отчёт — `infra/security/zap-report.html`. Цель — **без FAIL-алертов** (высокий риск). Ложные срабатывания
переводятся в IGNORE/WARN в `infra/security/zap-rules.tsv` (с комментарием). Обязательные заголовки (CSP,
HSTS, anti-CSRF) в правилах помечены FAIL — они не должны регрессировать.

## 4. 2FA у привилегированных аккаунтов

Enforcement уже в коде: `TotpEnrollmentGuard` заставляет включить TOTP при входе всех, кто держит право из
`PERMISSIONS_REQUIRING_2FA` (packages/shared). Аудит — что никто не проскочил:

```bash
dc exec -T postgres psql -U cuks -d cuks -f - < infra/security/admins-without-2fa.sql
```

Должно вернуть **0 строк**. Любая строка — привилегированный аккаунт без 2FA (разбирать).

## 5. Дефолтные пароли

- Все секреты прод-стека берутся из `.env` через `${VAR:?...}` (compose падает, если не задан) — дефолтов в
  git нет. Проверка: `grep -nE 'password|secret' infra/docker/compose.prod.yaml` — только `${…}`/`:?`.
- Сменить дефолты MinIO (`S3_ACCESS_KEY`/`S3_SECRET_KEY`), GeoServer (`GEOSERVER_ADMIN_PASSWORD`), Postgres
  (`POSTGRES_PASSWORD`), LiveKit (`LIVEKIT_API_SECRET`), restic (`RESTIC_PASSWORD`) — см. `.env.prod.example`.
- `SEED_ADMIN_PASSWORD` — временный, форс-смена при первом входе; убедиться, что сменён.

## 6. Заголовки безопасности / CSP

Задаются Caddy (`infra/caddy/Caddyfile`): HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, снятие `Server`, и CSP. В CSP `script-src 'self'` (без `unsafe-inline` — главный вектор
XSS), `object-src 'none'`, `form-action 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`.
`style-src 'unsafe-inline'` оставлен осознанно: MapLibre GL / Radix инжектят inline-стили без хука под nonce;
инъекция стилей — низкий риск по сравнению со скриптами. Пересмотреть при переходе на nonce-совместимый
рантайм стилей.

## 7. Нагрузочная проверка лимитов и аудит

- **Rate-limit / lockout** — проверяются нагрузочно (k6 smoke), см. `docs/runbook-load.md`. `@Throttle` на
  auth-эндпоинтах (per-IP), lockout по неудачным логинам (docs/05 §1).
- **Аудит** — значимые бизнес-события пишутся в `audit.audit_log` (перечень — в спеках модулей). Просмотр —
  админка «Аудит» (`admin.audit.view`) с фильтрами и CSV.
- **Бэкап-restore drill** — `docs/runbook-backup.md` (проверено в 7.2).
