DROP INDEX "gis"."layers_slug_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "layers_slug_uq" ON "gis"."layers" USING btree ("slug") WHERE "gis"."layers"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "app"."gis_imports" ADD CONSTRAINT "gis_imports_status_chk" CHECK ("app"."gis_imports"."status" in ('pending', 'processing', 'done', 'failed'));--> statement-breakpoint
ALTER TABLE "app"."incident_resources" ADD CONSTRAINT "incident_resources_kind_chk" CHECK ("app"."incident_resources"."kind" in ('personnel', 'vehicle', 'equipment', 'aviation'));--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_source_chk" CHECK ("app"."incidents"."source" in ('phone', 'report_doc', 'monitoring', 'other'));