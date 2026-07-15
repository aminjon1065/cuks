CREATE TABLE "app"."route_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"route_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"kind" text NOT NULL,
	"mode" text DEFAULT 'sequential' NOT NULL,
	"assignee_type" text NOT NULL,
	"assignee_id" uuid NOT NULL,
	"due_hours" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision" text,
	"comment" text,
	"acted_by" uuid,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."route_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"org_unit_id" uuid,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "app"."route_steps" ADD CONSTRAINT "route_steps_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "app"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."route_steps" ADD CONSTRAINT "route_steps_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."route_templates" ADD CONSTRAINT "route_templates_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."route_templates" ADD CONSTRAINT "route_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."routes" ADD CONSTRAINT "routes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."routes" ADD CONSTRAINT "routes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_steps_route_idx" ON "app"."route_steps" USING btree ("route_id","step_order");--> statement-breakpoint
CREATE INDEX "route_steps_assignee_idx" ON "app"."route_steps" USING btree ("status","assignee_type","assignee_id");--> statement-breakpoint
CREATE INDEX "route_templates_active_idx" ON "app"."route_templates" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "routes_document_idx" ON "app"."routes" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_one_active_uq" ON "app"."routes" USING btree ("document_id") WHERE "app"."routes"."status" = 'active';