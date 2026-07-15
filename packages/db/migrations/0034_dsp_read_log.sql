-- ДСП read log (docs/09-security.md §3, docs/07 §read_log): the access trail for restricted
-- documents — a row per open of a ДСП document and per download of its file. Hand-written like
-- audit_log (0005) because the whole `audit` schema is kept out of drizzle-kit's management; the
-- type mirror lives in packages/db/src/unmanaged/read-log.ts. Append-only — UPDATE/DELETE are
-- denied to the application PG role at deployment (docs/09 §PG-role); the app only ever inserts.
CREATE TABLE "audit"."read_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"actor_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
-- The read-log view for a document filters by (entity_type, entity_id) newest-first.
CREATE INDEX "read_log_entity_idx" ON "audit"."read_log" USING btree ("entity_type", "entity_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "read_log_actor_created_idx" ON "audit"."read_log" USING btree ("actor_id", "created_at");
