-- Custom SQL migration file, put your code below! --

-- Slow-query profiling (docs/runbook-load.md, task 7.4). The collector library is preloaded via the
-- postgres `command` in infra/docker/compose.{dev,prod}.yaml (needs a server restart); this creates the
-- view. IF NOT EXISTS so it is idempotent and safe if an operator already created it by hand.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;