-- Top slow queries from pg_stat_statements (docs/runbook-load.md, task 7.4). Enable the extension first
-- (postgres `command` preload + migration 0045), then: reset, run a k6 load, and read this.
--
--   docker compose --env-file .env -f infra/docker/compose.prod.yaml exec -T postgres \
--     psql -U cuks -d cuks -f - < infra/load/slow-queries.sql
--
-- To reset the accumulated stats before a fresh run:
--   ... psql -U cuks -d cuks -c 'SELECT pg_stat_statements_reset();'

SELECT
  calls,
  round(total_exec_time::numeric, 1)                                        AS total_ms,
  round(mean_exec_time::numeric, 2)                                         AS mean_ms,
  round((100 * total_exec_time / NULLIF(sum(total_exec_time) OVER (), 0))::numeric, 1) AS pct_total,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 140)                        AS query
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
  AND query NOT LIKE '%pg_catalog%'
ORDER BY total_exec_time DESC
LIMIT 25;
