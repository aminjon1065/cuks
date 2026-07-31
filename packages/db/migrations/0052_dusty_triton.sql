CREATE TABLE "app"."document_dispatches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_address" text,
	"recipient_contact" text,
	"external_reference" text,
	"note" text,
	"receipt_file_id" uuid,
	"attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	"created_by" uuid,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."document_dispatches" ADD CONSTRAINT "document_dispatches_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_dispatches" ADD CONSTRAINT "document_dispatches_receipt_file_id_fs_nodes_id_fk" FOREIGN KEY ("receipt_file_id") REFERENCES "app"."fs_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_dispatches" ADD CONSTRAINT "document_dispatches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_dispatches" ADD CONSTRAINT "document_dispatches_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_dispatches_document_idx" ON "app"."document_dispatches" USING btree ("document_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "document_dispatches_status_idx" ON "app"."document_dispatches" USING btree ("status","attempted_at");