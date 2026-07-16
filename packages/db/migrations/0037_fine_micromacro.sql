CREATE TABLE "app"."task_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."task_checklist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"text" text NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"order_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."task_columns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"order_key" text NOT NULL,
	"wip_limit" integer,
	"is_done_column" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."task_labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."task_project_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."task_projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"org_unit_id" uuid,
	"visible_to_org_unit" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"title" text NOT NULL,
	"description" jsonb,
	"description_text" text,
	"assignee_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"watcher_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"author_id" uuid NOT NULL,
	"priority" text DEFAULT 'p3' NOT NULL,
	"due_at" timestamp with time zone,
	"start_at" timestamp with time zone,
	"labels" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"order_in_column" text NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian', "title" || ' ' || coalesce("description_text", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."task_activity" ADD CONSTRAINT "task_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_activity" ADD CONSTRAINT "task_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_columns" ADD CONSTRAINT "task_columns_project_id_task_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "app"."task_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_labels" ADD CONSTRAINT "task_labels_project_id_task_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "app"."task_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_project_members" ADD CONSTRAINT "task_project_members_project_id_task_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "app"."task_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_project_members" ADD CONSTRAINT "task_project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_projects" ADD CONSTRAINT "task_projects_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_projects" ADD CONSTRAINT "task_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_project_id_task_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "app"."task_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_column_id_task_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "app"."task_columns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_activity_task_idx" ON "app"."task_activity" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_checklist_task_idx" ON "app"."task_checklist_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_columns_project_idx" ON "app"."task_columns" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_labels_project_idx" ON "app"."task_labels" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_project_members_uq" ON "app"."task_project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "task_project_members_user_idx" ON "app"."task_project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_projects_key_uq" ON "app"."task_projects" USING btree ("key") WHERE "app"."task_projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_projects_org_unit_idx" ON "app"."task_projects" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "tasks_project_column_idx" ON "app"."tasks" USING btree ("project_id","column_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_seq_uq" ON "app"."tasks" USING btree ("project_id","seq");--> statement-breakpoint
CREATE INDEX "tasks_assignees_idx" ON "app"."tasks" USING gin ("assignee_ids");--> statement-breakpoint
CREATE INDEX "tasks_watchers_idx" ON "app"."tasks" USING gin ("watcher_ids");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "app"."tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "tasks_search_idx" ON "app"."tasks" USING gin ("search_tsv");