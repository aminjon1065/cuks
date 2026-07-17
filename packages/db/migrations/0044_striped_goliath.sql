CREATE TABLE "app"."backup_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot_id" text,
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "backup_runs_finished_at_idx" ON "app"."backup_runs" USING btree ("finished_at" DESC NULLS LAST);