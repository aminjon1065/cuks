ALTER TABLE "app"."task_checklist_items" ALTER COLUMN "order_key" SET DATA TYPE text collate "C";--> statement-breakpoint
ALTER TABLE "app"."task_columns" ALTER COLUMN "order_key" SET DATA TYPE text collate "C";--> statement-breakpoint
ALTER TABLE "app"."tasks" ALTER COLUMN "order_in_column" SET DATA TYPE text collate "C";