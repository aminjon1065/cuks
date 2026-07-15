CREATE TABLE "app"."correspondents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"category_code" text,
	"address" text,
	"phones" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian', "name" || ' ' || coalesce("short_name", ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "app"."journal_counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"journal_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."journals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"doc_class" text NOT NULL,
	"number_template" text NOT NULL,
	"seq_reset" text DEFAULT 'yearly' NOT NULL,
	"org_unit_id" uuid,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."nomenclature" (
	"id" uuid PRIMARY KEY NOT NULL,
	"index" text NOT NULL,
	"title" text NOT NULL,
	"org_unit_id" uuid,
	"retention_note" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "app"."correspondents" ADD CONSTRAINT "correspondents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."journal_counters" ADD CONSTRAINT "journal_counters_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "app"."journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."journals" ADD CONSTRAINT "journals_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."journals" ADD CONSTRAINT "journals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."nomenclature" ADD CONSTRAINT "nomenclature_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."nomenclature" ADD CONSTRAINT "nomenclature_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "correspondents_search_idx" ON "app"."correspondents" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "correspondents_active_idx" ON "app"."correspondents" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_counters_journal_year_uq" ON "app"."journal_counters" USING btree ("journal_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_code_uq" ON "app"."journals" USING btree ("code") WHERE "app"."journals"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "journals_doc_class_idx" ON "app"."journals" USING btree ("doc_class","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "nomenclature_index_uq" ON "app"."nomenclature" USING btree ("index") WHERE "app"."nomenclature"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "nomenclature_active_sort_idx" ON "app"."nomenclature" USING btree ("is_active","sort");