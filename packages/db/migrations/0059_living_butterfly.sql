CREATE TABLE "app"."document_exchange_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inbound_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."document_exchange_inbound" (
	"id" uuid PRIMARY KEY NOT NULL,
	"adapter_id" text NOT NULL,
	"external_id" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"subject" text NOT NULL,
	"summary" text,
	"sender_name" text,
	"sender_contact" text,
	"sent_at" timestamp with time zone,
	"correspondent_id" uuid,
	"type_code" text,
	"quarantine_reason" text,
	"rejected_reason" text,
	"document_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."document_exchange_attachments" ADD CONSTRAINT "document_exchange_attachments_inbound_id_document_exchange_inbound_id_fk" FOREIGN KEY ("inbound_id") REFERENCES "app"."document_exchange_inbound"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exchange_attachments" ADD CONSTRAINT "document_exchange_attachments_file_id_fs_nodes_id_fk" FOREIGN KEY ("file_id") REFERENCES "app"."fs_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exchange_inbound" ADD CONSTRAINT "document_exchange_inbound_correspondent_id_correspondents_id_fk" FOREIGN KEY ("correspondent_id") REFERENCES "app"."correspondents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exchange_inbound" ADD CONSTRAINT "document_exchange_inbound_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exchange_inbound" ADD CONSTRAINT "document_exchange_inbound_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_exchange_attachments_inbound_idx" ON "app"."document_exchange_attachments" USING btree ("inbound_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_exchange_inbound_external_uq" ON "app"."document_exchange_inbound" USING btree ("adapter_id","external_id");--> statement-breakpoint
CREATE INDEX "document_exchange_inbound_status_idx" ON "app"."document_exchange_inbound" USING btree ("status","received_at");