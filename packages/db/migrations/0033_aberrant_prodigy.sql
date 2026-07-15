CREATE TABLE "app"."document_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"src_document_id" uuid NOT NULL,
	"dst_document_id" uuid NOT NULL,
	"kind" text DEFAULT 'related' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."document_links" ADD CONSTRAINT "document_links_src_document_id_documents_id_fk" FOREIGN KEY ("src_document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_links" ADD CONSTRAINT "document_links_dst_document_id_documents_id_fk" FOREIGN KEY ("dst_document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_links" ADD CONSTRAINT "document_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_pair_uq" ON "app"."document_links" USING btree ("src_document_id","dst_document_id");--> statement-breakpoint
CREATE INDEX "document_links_src_idx" ON "app"."document_links" USING btree ("src_document_id");--> statement-breakpoint
CREATE INDEX "document_links_dst_idx" ON "app"."document_links" USING btree ("dst_document_id");