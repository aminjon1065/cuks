CREATE UNIQUE INDEX "acquaintances_batch_user_uq" ON "app"."acquaintances" USING btree ("batch_id","user_id") WHERE "app"."acquaintances"."batch_id" is not null;--> statement-breakpoint
-- Backfill: until now the route acknowledgement path wrote only `acknowledged_at` and left
-- `status` at 'pending', while the gate path wrote `status`. The two families of queries
-- therefore disagreed about the same fact. From here on both write `status`, so the rows
-- that predate the change are brought in line.
UPDATE "app"."acquaintances" SET "status" = 'acknowledged'
 WHERE "acknowledged_at" is not null AND "status" = 'pending';
