CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."dictionaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"code" text NOT NULL,
	"parent_code" text,
	"name_ru" text NOT NULL,
	"name_tg" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"short_name" text NOT NULL,
	"email" text,
	"phone" text,
	"avatar_file_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"locale" text DEFAULT 'ru' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "users_status_chk" CHECK ("app"."users"."status" in ('active', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "app"."org_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"short_name" text,
	"type" text NOT NULL,
	"path" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"head_position_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "org_units_type_chk" CHECK ("app"."org_units"."type" in ('committee', 'department', 'division', 'unit'))
);
--> statement-breakpoint
CREATE TABLE "app"."positions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"is_head" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."user_positions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."resource_acl" (
	"id" uuid PRIMARY KEY NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "resource_acl_level_chk" CHECK ("app"."resource_acl"."level" in ('viewer', 'editor', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "app"."role_permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."user_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"org_unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "user_roles_user_role_scope_uq" UNIQUE NULLS NOT DISTINCT("user_id","role_id","org_unit_id")
);
--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."org_units" ADD CONSTRAINT "org_units_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."org_units" ADD CONSTRAINT "org_units_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."positions" ADD CONSTRAINT "positions_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."positions" ADD CONSTRAINT "positions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_positions" ADD CONSTRAINT "user_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_positions" ADD CONSTRAINT "user_positions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "app"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resource_acl" ADD CONSTRAINT "resource_acl_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "app"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."roles" ADD CONSTRAINT "roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "app"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_roles" ADD CONSTRAINT "user_roles_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_roles" ADD CONSTRAINT "user_roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dictionaries_type_code_uq" ON "app"."dictionaries" USING btree ("type","code");--> statement-breakpoint
CREATE INDEX "dictionaries_type_active_sort_idx" ON "app"."dictionaries" USING btree ("type","is_active","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "app"."users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "app"."org_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "org_units_path_idx" ON "app"."org_units" USING btree ("path");--> statement-breakpoint
CREATE INDEX "positions_org_unit_idx" ON "app"."positions" USING btree ("org_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_positions_user_position_uq" ON "app"."user_positions" USING btree ("user_id","position_id");--> statement-breakpoint
CREATE INDEX "user_positions_position_idx" ON "app"."user_positions" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_acl_resource_subject_uq" ON "app"."resource_acl" USING btree ("resource_type","resource_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "resource_acl_resource_idx" ON "app"."resource_acl" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "resource_acl_subject_idx" ON "app"."resource_acl" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_uq" ON "app"."role_permissions" USING btree ("role_id","permission");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_code_uq" ON "app"."roles" USING btree ("code");--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "app"."user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "app"."user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_roles_org_unit_idx" ON "app"."user_roles" USING btree ("org_unit_id");