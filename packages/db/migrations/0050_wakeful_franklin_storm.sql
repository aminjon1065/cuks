ALTER TABLE "app"."route_steps" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."route_steps" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."route_steps" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "route_steps_due_idx" ON "app"."route_steps" USING btree ("due_at") WHERE "app"."route_steps"."status" = 'active' and "app"."route_steps"."due_at" is not null;