CREATE TABLE "app"."gis_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"format" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"file_name" text,
	"size_bytes" integer,
	"feature_count" integer,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "gis_exports_status_chk" CHECK ("app"."gis_exports"."status" in ('pending', 'processing', 'done', 'failed')),
	CONSTRAINT "gis_exports_source_chk" CHECK ("app"."gis_exports"."source" in ('layer', 'incidents')),
	CONSTRAINT "gis_exports_format_chk" CHECK ("app"."gis_exports"."format" in ('geojson', 'gpkg', 'shp', 'csv', 'xlsx'))
);
--> statement-breakpoint
ALTER TABLE "app"."gis_imports" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "app"."gis_imports" ADD COLUMN "source_name" text;--> statement-breakpoint
ALTER TABLE "app"."gis_imports" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "app"."gis_imports" ADD COLUMN "preview" jsonb;--> statement-breakpoint
ALTER TABLE "app"."gis_imports" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."gis_exports" ADD CONSTRAINT "gis_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gis_exports_created_by_idx" ON "app"."gis_exports" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "gis_imports_created_by_idx" ON "app"."gis_imports" USING btree ("created_by","created_at");