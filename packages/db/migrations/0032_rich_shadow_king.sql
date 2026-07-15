CREATE TABLE "app"."acquaintances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"route_step_id" uuid,
	"user_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."acquaintances" ADD CONSTRAINT "acquaintances_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."acquaintances" ADD CONSTRAINT "acquaintances_route_step_id_route_steps_id_fk" FOREIGN KEY ("route_step_id") REFERENCES "app"."route_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."acquaintances" ADD CONSTRAINT "acquaintances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acquaintances_step_user_uq" ON "app"."acquaintances" USING btree ("route_step_id","user_id");--> statement-breakpoint
CREATE INDEX "acquaintances_document_idx" ON "app"."acquaintances" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "acquaintances_user_pending_idx" ON "app"."acquaintances" USING btree ("user_id","acknowledged_at");