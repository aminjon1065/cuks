-- Chat messages (docs/modules/13 §3, task 5.1): RANGE-partitioned by month on created_at.
-- Hand-written because drizzle-kit can't express PARTITION BY; the type mirror lives in
-- packages/db/src/unmanaged/chat-messages.ts. Kept forever (гос-архив, §9); a retention job
-- creates future partitions. reply_to_id / channel_id / author_id are plain uuids (no FK) — a
-- partitioned table's composite PK (id, created_at) makes inbound FKs impractical.
CREATE TABLE "app"."chat_messages" (
	"id" uuid NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"channel_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" text NOT NULL DEFAULT 'text',
	"body" jsonb,
	"body_text" text,
	"reply_to_id" uuid,
	"file_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
	"edited_at" timestamptz,
	"deleted_at" timestamptz,
	"search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('russian', coalesce("body_text", ''))) STORED,
	CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
-- Indexes on the parent propagate to every partition automatically.
CREATE INDEX "chat_messages_channel_created_idx" ON "app"."chat_messages" USING btree ("channel_id", "created_at");
--> statement-breakpoint
CREATE INDEX "chat_messages_search_idx" ON "app"."chat_messages" USING gin ("search_tsv");
--> statement-breakpoint
-- Idempotent monthly-partition creator. Boundaries are anchored to UTC midnight via
-- make_timestamptz(...,'UTC') — NOT date::timestamptz, which resolves under the session TimeZone
-- (deploy TZ is Asia/Dushanbe) and could misalign. A retention cron calls this a few months ahead;
-- until then the DEFAULT partition catches everything.
CREATE OR REPLACE FUNCTION "app"."ensure_chat_messages_partition"(target date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
	month_start date := date_trunc('month', target)::date;
	lower_b timestamptz := make_timestamptz(
		EXTRACT(year FROM month_start)::int, EXTRACT(month FROM month_start)::int, 1, 0, 0, 0, 'UTC');
	upper_b timestamptz := lower_b + interval '1 month';
	part    text := 'chat_messages_' || to_char(lower_b AT TIME ZONE 'UTC', 'YYYY_MM');
BEGIN
	IF to_regclass(format('app.%I', part)) IS NULL THEN
		EXECUTE format(
			'CREATE TABLE app.%I PARTITION OF app.chat_messages FOR VALUES FROM (%L) TO (%L)',
			part, lower_b, upper_b);
	END IF;
END;
$$;
--> statement-breakpoint
-- Current month + 3 ahead, plus a DEFAULT safety net so an insert never fails.
SELECT "app"."ensure_chat_messages_partition"((now() + (n || ' months')::interval)::date)
FROM generate_series(0, 3) AS n;
--> statement-breakpoint
CREATE TABLE "app"."chat_messages_default" PARTITION OF "app"."chat_messages" DEFAULT;
