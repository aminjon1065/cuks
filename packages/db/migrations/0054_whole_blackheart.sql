CREATE TABLE "app"."archive_disposition_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"decision_comment" text,
	"created_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."archive_disposition_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "retention_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "retention_months" integer;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "is_permanent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "legal_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "legal_hold_reason" text;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "legal_hold_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "disposition_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "disposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "disposed_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."nomenclature" ADD COLUMN "retention_months" integer;--> statement-breakpoint
ALTER TABLE "app"."nomenclature" ADD COLUMN "is_permanent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."nomenclature" ADD COLUMN "archive_org_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."nomenclature" ADD COLUMN "disposition_requires_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."archive_disposition_batches" ADD CONSTRAINT "archive_disposition_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."archive_disposition_batches" ADD CONSTRAINT "archive_disposition_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."archive_disposition_items" ADD CONSTRAINT "archive_disposition_items_batch_id_archive_disposition_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "app"."archive_disposition_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."archive_disposition_items" ADD CONSTRAINT "archive_disposition_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "archive_disposition_batches_number_uq" ON "app"."archive_disposition_batches" USING btree ("number") WHERE "app"."archive_disposition_batches"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "archive_disposition_batches_status_idx" ON "app"."archive_disposition_batches" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "archive_disposition_items_pair_uq" ON "app"."archive_disposition_items" USING btree ("batch_id","document_id");--> statement-breakpoint
CREATE INDEX "archive_disposition_items_document_idx" ON "app"."archive_disposition_items" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_legal_hold_by_users_id_fk" FOREIGN KEY ("legal_hold_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_disposed_by_users_id_fk" FOREIGN KEY ("disposed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."nomenclature" ADD CONSTRAINT "nomenclature_archive_org_unit_id_org_units_id_fk" FOREIGN KEY ("archive_org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_archived_idx" ON "app"."documents" USING btree ("status","archived_at" DESC NULLS LAST) WHERE "app"."documents"."archived_at" is not null;--> statement-breakpoint
CREATE INDEX "documents_retention_idx" ON "app"."documents" USING btree ("retention_until","disposition_status") WHERE "app"."documents"."archived_at" is not null and "app"."documents"."is_permanent" = false;