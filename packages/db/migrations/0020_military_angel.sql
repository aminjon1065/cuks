CREATE TABLE "app"."notification_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_attempts_chk" CHECK ("app"."notification_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_dedupe_uq" ON "app"."notification_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "app"."notification_outbox" USING btree ("next_attempt_at","created_at") WHERE "app"."notification_outbox"."processed_at" is null;