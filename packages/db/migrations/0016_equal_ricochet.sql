CREATE TABLE "app"."saved_filters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"module" text NOT NULL,
	"name" text NOT NULL,
	"params" jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."incident_reports" ADD COLUMN "damage_est" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "app"."incident_reports" ADD COLUMN "damage_note" text;--> statement-breakpoint
ALTER TABLE "app"."saved_filters" ADD CONSTRAINT "saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_filters_user_module_idx" ON "app"."saved_filters" USING btree ("user_id","module","created_at");--> statement-breakpoint
CREATE INDEX "saved_filters_module_idx" ON "app"."saved_filters" USING btree ("module");