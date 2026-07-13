CREATE TABLE "app"."file_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"s3_upload_id" text NOT NULL,
	"parent_id" uuid,
	"target_node_id" uuid,
	"name" text NOT NULL,
	"space" text NOT NULL,
	"owner_user_id" uuid,
	"owner_org_unit_id" uuid,
	"declared_size" bigint NOT NULL,
	"mime" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "file_uploads_space_chk" CHECK ("app"."file_uploads"."space" in ('personal', 'org', 'system'))
);
--> statement-breakpoint
CREATE TABLE "app"."file_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"node_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"av_status" text DEFAULT 'pending' NOT NULL,
	"extracted_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_versions_av_status_chk" CHECK ("app"."file_versions"."av_status" in ('pending', 'clean', 'infected'))
);
--> statement-breakpoint
CREATE TABLE "app"."fs_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"space" text NOT NULL,
	"owner_user_id" uuid,
	"owner_org_unit_id" uuid,
	"current_version_id" uuid,
	"size_cached" bigint DEFAULT 0 NOT NULL,
	"mime" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"starred_by" uuid[] DEFAULT '{}' NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "fs_nodes_kind_chk" CHECK ("app"."fs_nodes"."kind" in ('folder', 'file')),
	CONSTRAINT "fs_nodes_space_chk" CHECK ("app"."fs_nodes"."space" in ('personal', 'org', 'system'))
);
--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "app"."org_units" ADD COLUMN "quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "app"."file_uploads" ADD CONSTRAINT "file_uploads_parent_id_fs_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."fs_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_uploads" ADD CONSTRAINT "file_uploads_target_node_id_fs_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "app"."fs_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_uploads" ADD CONSTRAINT "file_uploads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_uploads" ADD CONSTRAINT "file_uploads_owner_org_unit_id_org_units_id_fk" FOREIGN KEY ("owner_org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_uploads" ADD CONSTRAINT "file_uploads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_versions" ADD CONSTRAINT "file_versions_node_id_fs_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "app"."fs_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_versions" ADD CONSTRAINT "file_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fs_nodes" ADD CONSTRAINT "fs_nodes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fs_nodes" ADD CONSTRAINT "fs_nodes_owner_org_unit_id_org_units_id_fk" FOREIGN KEY ("owner_org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fs_nodes" ADD CONSTRAINT "fs_nodes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fs_nodes" ADD CONSTRAINT "fs_nodes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."fs_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_node_version_uq" ON "app"."file_versions" USING btree ("node_id","version");--> statement-breakpoint
CREATE INDEX "file_versions_node_idx" ON "app"."file_versions" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "fs_nodes_parent_idx" ON "app"."fs_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "fs_nodes_path_idx" ON "app"."fs_nodes" USING btree ("path" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "fs_nodes_owner_user_idx" ON "app"."fs_nodes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "fs_nodes_owner_org_unit_idx" ON "app"."fs_nodes" USING btree ("owner_org_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fs_nodes_org_root_uq" ON "app"."fs_nodes" USING btree ("owner_org_unit_id") WHERE "app"."fs_nodes"."parent_id" is null and "app"."fs_nodes"."space" = 'org';