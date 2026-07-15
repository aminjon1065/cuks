ALTER TABLE "app"."org_units" ADD COLUMN "admin_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."org_units" ADD CONSTRAINT "org_units_admin_unit_fk" FOREIGN KEY ("admin_unit_id") REFERENCES "gis"."admin_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_units_admin_unit_idx" ON "app"."org_units" USING btree ("admin_unit_id");