CREATE TABLE "app"."entity_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."task_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"description" jsonb,
	"description_text" text,
	"priority" text DEFAULT 'p3' NOT NULL,
	"checklist" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."entity_links" ADD CONSTRAINT "entity_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_templates" ADD CONSTRAINT "task_templates_project_id_task_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "app"."task_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_templates" ADD CONSTRAINT "task_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_links_pair_uq" ON "app"."entity_links" USING btree ("source_type","source_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "entity_links_source_idx" ON "app"."entity_links" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "entity_links_target_idx" ON "app"."entity_links" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "task_templates_project_idx" ON "app"."task_templates" USING btree ("project_id");