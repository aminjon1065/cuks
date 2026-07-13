-- Audit log (docs/07 §audit): RANGE-partitioned by month on created_at. Hand-written
-- because drizzle-kit can't express PARTITION BY; the type mirror lives in
-- packages/db/src/unmanaged/audit-log.ts. Append-only — UPDATE/DELETE are denied to
-- the application PG role at deployment (docs/09 §PG-role); the app only ever inserts.
CREATE SCHEMA IF NOT EXISTS "audit";
--> statement-breakpoint
CREATE TABLE "audit"."audit_log" (
	"id" uuid NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"org_unit_id" uuid,
	"ip" text,
	"user_agent" text,
	"meta" jsonb,
	CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
-- Indexes on the parent propagate to every partition automatically.
CREATE INDEX "audit_log_entity_idx" ON "audit"."audit_log" USING btree ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX "audit_log_actor_created_idx" ON "audit"."audit_log" USING btree ("actor_id", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_log_created_brin" ON "audit"."audit_log" USING brin ("created_at");
--> statement-breakpoint
-- Idempotent monthly-partition creator. Boundaries are anchored to UTC midnight via
-- make_timestamptz(...,'UTC') — NOT date::timestamptz, which would resolve under the
-- session TimeZone (deploy TZ is Asia/Dushanbe) and could misalign if a later caller
-- runs under a different TZ. The BullMQ cron (phase 0.13) calls this a couple of
-- months ahead; until then the DEFAULT partition catches everything.
CREATE OR REPLACE FUNCTION "audit"."ensure_audit_log_partition"(target date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
	month_start date := date_trunc('month', target)::date;
	lower_b timestamptz := make_timestamptz(
		EXTRACT(year FROM month_start)::int, EXTRACT(month FROM month_start)::int, 1, 0, 0, 0, 'UTC');
	upper_b timestamptz := lower_b + interval '1 month';
	part    text := 'audit_log_' || to_char(lower_b AT TIME ZONE 'UTC', 'YYYY_MM');
BEGIN
	IF to_regclass(format('audit.%I', part)) IS NULL THEN
		EXECUTE format(
			'CREATE TABLE audit.%I PARTITION OF audit.audit_log FOR VALUES FROM (%L) TO (%L)',
			part, lower_b, upper_b);
	END IF;
END;
$$;
--> statement-breakpoint
-- Current month + 3 ahead, plus a DEFAULT safety net so an insert never fails.
SELECT "audit"."ensure_audit_log_partition"((now() + (n || ' months')::interval)::date)
FROM generate_series(0, 3) AS n;
--> statement-breakpoint
CREATE TABLE "audit"."audit_log_default" PARTITION OF "audit"."audit_log" DEFAULT;
