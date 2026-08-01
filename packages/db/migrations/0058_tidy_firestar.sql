ALTER TABLE "app"."document_dispatches" ADD COLUMN "adapter_id" text;--> statement-breakpoint
ALTER TABLE "app"."document_dispatches" ADD COLUMN "attempt_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."document_dispatches" ADD COLUMN "retry_of" uuid;--> statement-breakpoint
ALTER TABLE "app"."document_dispatches" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."document_dispatches" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."document_dispatches" ADD CONSTRAINT "document_dispatches_retry_of_document_dispatches_id_fk" FOREIGN KEY ("retry_of") REFERENCES "app"."document_dispatches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_dispatches_due_idx" ON "app"."document_dispatches" USING btree ("next_attempt_at") WHERE "app"."document_dispatches"."next_attempt_at" is not null and "app"."document_dispatches"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "document_dispatches_dead_letter_idx" ON "app"."document_dispatches" USING btree ("dead_lettered_at" DESC NULLS LAST) WHERE "app"."document_dispatches"."dead_lettered_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_dispatches_adapter_reference_uq" ON "app"."document_dispatches" USING btree ("adapter_id","external_reference") WHERE "app"."document_dispatches"."adapter_id" is not null and "app"."document_dispatches"."external_reference" is not null;