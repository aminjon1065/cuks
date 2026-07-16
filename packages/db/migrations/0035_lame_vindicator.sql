CREATE TABLE "app"."substitutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"principal_id" uuid NOT NULL,
	"deputy_id" uuid NOT NULL,
	"scope" text DEFAULT 'docflow' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."signatures" ADD COLUMN "on_behalf_of" uuid;--> statement-breakpoint
ALTER TABLE "app"."substitutions" ADD CONSTRAINT "substitutions_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."substitutions" ADD CONSTRAINT "substitutions_deputy_id_users_id_fk" FOREIGN KEY ("deputy_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."substitutions" ADD CONSTRAINT "substitutions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "substitutions_deputy_idx" ON "app"."substitutions" USING btree ("deputy_id","is_active");--> statement-breakpoint
CREATE INDEX "substitutions_principal_idx" ON "app"."substitutions" USING btree ("principal_id");--> statement-breakpoint
ALTER TABLE "app"."signatures" ADD CONSTRAINT "signatures_on_behalf_of_users_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;