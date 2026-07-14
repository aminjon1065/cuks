ALTER TABLE "app"."notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_uq" ON "app"."notifications" USING btree ("user_id","dedupe_key") WHERE "app"."notifications"."dedupe_key" is not null;--> statement-breakpoint
-- data: normalize pre-2.6 lifecycle rows before enforcing the closed timestamp invariant.
UPDATE "app"."incidents"
SET "closed_at" = COALESCE("updated_at", "reported_at"),
    "closed_by" = COALESCE("closed_by", "created_by")
WHERE "status" = 'closed' AND "closed_at" IS NULL;--> statement-breakpoint
UPDATE "app"."incidents"
SET "closed_at" = NULL,
    "closed_by" = NULL
WHERE "status" <> 'closed' AND ("closed_at" IS NOT NULL OR "closed_by" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_closed_at_chk" CHECK (("app"."incidents"."status" = 'closed') = ("app"."incidents"."closed_at" is not null));
