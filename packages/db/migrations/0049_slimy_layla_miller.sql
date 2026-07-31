CREATE TABLE "app"."document_template_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_json" jsonb,
	"content_text" text,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."document_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"doc_class" text NOT NULL,
	"document_type_code" text,
	"org_unit_id" uuid,
	"route_template_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "content_json" jsonb;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "content_text" text;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."document_template_versions" ADD CONSTRAINT "document_template_versions_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."document_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_template_versions" ADD CONSTRAINT "document_template_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_template_versions" ADD CONSTRAINT "document_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_templates" ADD CONSTRAINT "document_templates_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_templates" ADD CONSTRAINT "document_templates_route_template_id_route_templates_id_fk" FOREIGN KEY ("route_template_id") REFERENCES "app"."route_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_templates" ADD CONSTRAINT "document_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_templates" ADD CONSTRAINT "document_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_uq" ON "app"."document_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "document_template_versions_template_idx" ON "app"."document_template_versions" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_templates_code_uq" ON "app"."document_templates" USING btree ("code") WHERE "app"."document_templates"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "document_templates_pick_idx" ON "app"."document_templates" USING btree ("doc_class","is_active");