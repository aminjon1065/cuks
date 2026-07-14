CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE SCHEMA "gis";
--> statement-breakpoint
CREATE TABLE "gis"."admin_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"level" text NOT NULL,
	"code" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_tg" text NOT NULL,
	"population" integer,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_units_level_chk" CHECK ("gis"."admin_units"."level" in ('region', 'district', 'jamoat'))
);
--> statement-breakpoint
CREATE TABLE "gis"."facilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"geom" geometry(Point,4326) NOT NULL,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"org_unit_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gis"."layers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"geometry_type" text,
	"table_name" text,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_published_wms" boolean DEFAULT false NOT NULL,
	"min_zoom" integer,
	"max_zoom" integer,
	"description" text,
	"org_unit_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "layers_kind_chk" CHECK ("gis"."layers"."kind" in ('system', 'imported', 'drawn'))
);
--> statement-breakpoint
CREATE TABLE "gis"."layer_features" (
	"id" uuid PRIMARY KEY NOT NULL,
	"layer_id" uuid NOT NULL,
	"geom" geometry(Geometry,4326) NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gis"."risk_zones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hazard_code" text NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_zones_level_chk" CHECK ("gis"."risk_zones"."level" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "app"."gis_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_id" uuid,
	"layer_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"log" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"text" text,
	"dead" integer,
	"injured" integer,
	"evacuated" integer,
	"affected" integer,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"org_text" text,
	"period" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"type_code" text NOT NULL,
	"severity" integer NOT NULL,
	"status" text DEFAULT 'reported' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"region_id" uuid,
	"district_id" uuid,
	"jamoat_id" uuid,
	"geom" geometry(Geometry,4326) NOT NULL,
	"address_text" text,
	"description" text,
	"source" text DEFAULT 'phone' NOT NULL,
	"dead" integer DEFAULT 0 NOT NULL,
	"injured" integer DEFAULT 0 NOT NULL,
	"evacuated" integer DEFAULT 0 NOT NULL,
	"affected" integer DEFAULT 0 NOT NULL,
	"damage_est" numeric(18, 2),
	"damage_note" text,
	"org_unit_id" uuid,
	"created_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian', "number" || ' ' || coalesce("description", '') || ' ' || coalesce("address_text", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "incidents_severity_chk" CHECK ("app"."incidents"."severity" between 1 and 5),
	CONSTRAINT "incidents_status_chk" CHECK ("app"."incidents"."status" in ('reported', 'active', 'localized', 'eliminated', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "gis"."admin_units" ADD CONSTRAINT "admin_units_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "gis"."admin_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis"."facilities" ADD CONSTRAINT "facilities_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis"."layers" ADD CONSTRAINT "layers_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis"."layers" ADD CONSTRAINT "layers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis"."layer_features" ADD CONSTRAINT "layer_features_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "gis"."layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis"."layer_features" ADD CONSTRAINT "layer_features_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gis"."risk_zones" ADD CONSTRAINT "risk_zones_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."gis_imports" ADD CONSTRAINT "gis_imports_file_id_fs_nodes_id_fk" FOREIGN KEY ("file_id") REFERENCES "app"."fs_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."gis_imports" ADD CONSTRAINT "gis_imports_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "gis"."layers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."gis_imports" ADD CONSTRAINT "gis_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_reports" ADD CONSTRAINT "incident_reports_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_reports" ADD CONSTRAINT "incident_reports_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_resources" ADD CONSTRAINT "incident_resources_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_region_id_admin_units_id_fk" FOREIGN KEY ("region_id") REFERENCES "gis"."admin_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_district_id_admin_units_id_fk" FOREIGN KEY ("district_id") REFERENCES "gis"."admin_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_jamoat_id_admin_units_id_fk" FOREIGN KEY ("jamoat_id") REFERENCES "gis"."admin_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_units_code_uq" ON "gis"."admin_units" USING btree ("code");--> statement-breakpoint
CREATE INDEX "admin_units_parent_idx" ON "gis"."admin_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "admin_units_level_idx" ON "gis"."admin_units" USING btree ("level");--> statement-breakpoint
CREATE INDEX "admin_units_geom_gix" ON "gis"."admin_units" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "facilities_geom_gix" ON "gis"."facilities" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "facilities_kind_idx" ON "gis"."facilities" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "layers_slug_uq" ON "gis"."layers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "layers_kind_idx" ON "gis"."layers" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "layer_features_geom_gix" ON "gis"."layer_features" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "layer_features_layer_idx" ON "gis"."layer_features" USING btree ("layer_id");--> statement-breakpoint
CREATE INDEX "risk_zones_geom_gix" ON "gis"."risk_zones" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "risk_zones_hazard_idx" ON "gis"."risk_zones" USING btree ("hazard_code");--> statement-breakpoint
CREATE INDEX "incident_reports_incident_idx" ON "app"."incident_reports" USING btree ("incident_id","reported_at");--> statement-breakpoint
CREATE INDEX "incident_resources_incident_idx" ON "app"."incident_resources" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_number_uq" ON "app"."incidents" USING btree ("number");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "app"."incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incidents_type_idx" ON "app"."incidents" USING btree ("type_code");--> statement-breakpoint
CREATE INDEX "incidents_region_idx" ON "app"."incidents" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "incidents_district_idx" ON "app"."incidents" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "incidents_occurred_idx" ON "app"."incidents" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "incidents_geom_gix" ON "app"."incidents" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "incidents_search_tsv_idx" ON "app"."incidents" USING gin ("search_tsv");