CREATE TABLE "app"."document_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"journal_id" uuid,
	"reg_number" text,
	"reg_date" timestamp with time zone,
	"doc_class" text NOT NULL,
	"type_code" text NOT NULL,
	"subject" text NOT NULL,
	"summary" text,
	"org_unit_id" uuid,
	"author_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"confidentiality" text DEFAULT 'normal' NOT NULL,
	"access_list" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"due_date" timestamp with time zone,
	"case_index" text,
	"correspondent_id" uuid,
	"outgoing_number" text,
	"outgoing_date" timestamp with time zone,
	"delivery" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian', "subject" || ' ' || coalesce("summary", '') || ' ' || coalesce("reg_number", ''))) STORED
);
--> statement-breakpoint
ALTER TABLE "app"."document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_files" ADD CONSTRAINT "document_files_file_id_fs_nodes_id_fk" FOREIGN KEY ("file_id") REFERENCES "app"."fs_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_files" ADD CONSTRAINT "document_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "app"."journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_correspondent_id_correspondents_id_fk" FOREIGN KEY ("correspondent_id") REFERENCES "app"."correspondents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_files_document_idx" ON "app"."document_files" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_files_current_main_uq" ON "app"."document_files" USING btree ("document_id") WHERE "app"."document_files"."kind" = 'main' and "app"."document_files"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "documents_journal_reg_number_uq" ON "app"."documents" USING btree ("journal_id","reg_number") WHERE "app"."documents"."reg_number" is not null;--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "app"."documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_author_idx" ON "app"."documents" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "documents_org_unit_idx" ON "app"."documents" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "documents_journal_idx" ON "app"."documents" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "app"."documents" USING gin ("search_tsv");