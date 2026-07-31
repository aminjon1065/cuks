ALTER TABLE "app"."documents" drop column "search_tsv";--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('russian', coalesce("subject", '') || ' ' || coalesce("reg_number", '')), 'A')
       || setweight(to_tsvector('russian', coalesce("summary", '') || ' ' || coalesce("sender_name", '') || ' ' || coalesce("recipient_name", '')), 'B')
       || setweight(to_tsvector('russian', coalesce("content_text", '')), 'C')) STORED;--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "app"."documents" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "documents_class_reg_date_idx" ON "app"."documents" USING btree ("doc_class","reg_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_correspondent_reg_date_idx" ON "app"."documents" USING btree ("correspondent_id","reg_date" DESC NULLS LAST) WHERE "app"."documents"."correspondent_id" is not null;--> statement-breakpoint
CREATE INDEX "documents_reg_number_prefix_idx" ON "app"."documents" USING btree ("reg_number" text_pattern_ops) WHERE "app"."documents"."reg_number" is not null;--> statement-breakpoint
CREATE INDEX "documents_due_date_idx" ON "app"."documents" USING btree ("due_date") WHERE "app"."documents"."due_date" is not null and "app"."documents"."deleted_at" is null;