DROP INDEX "app"."users_username_uq";--> statement-breakpoint
DROP INDEX "app"."org_units_path_idx";--> statement-breakpoint
DROP INDEX "app"."roles_code_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "app"."users" USING btree ("username") WHERE "app"."users"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "org_units_path_idx" ON "app"."org_units" USING btree ("path" text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "roles_code_uq" ON "app"."roles" USING btree ("code") WHERE "app"."roles"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "app"."dictionaries" ADD CONSTRAINT "dictionaries_type_chk" CHECK ("app"."dictionaries"."type" in ('incident_type', 'hazard_level', 'doc_type', 'correspondent_category'));--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_locale_chk" CHECK ("app"."users"."locale" in ('ru', 'tg'));--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_theme_chk" CHECK ("app"."users"."theme" in ('system', 'light', 'dark'));--> statement-breakpoint
ALTER TABLE "app"."resource_acl" ADD CONSTRAINT "resource_acl_resource_type_chk" CHECK ("app"."resource_acl"."resource_type" in ('folder', 'file', 'layer', 'project', 'channel', 'recording', 'report'));--> statement-breakpoint
ALTER TABLE "app"."resource_acl" ADD CONSTRAINT "resource_acl_subject_type_chk" CHECK ("app"."resource_acl"."subject_type" in ('user', 'org_unit', 'role'));