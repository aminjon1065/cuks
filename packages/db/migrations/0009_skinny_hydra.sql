ALTER TABLE "app"."file_versions" ADD COLUMN "extracted_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian', coalesce("extracted_text", ''))) STORED;--> statement-breakpoint
ALTER TABLE "app"."fs_nodes" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian', "name")) STORED;--> statement-breakpoint
CREATE INDEX "file_versions_extracted_tsv_idx" ON "app"."file_versions" USING gin ("extracted_tsv");--> statement-breakpoint
CREATE INDEX "fs_nodes_search_tsv_idx" ON "app"."fs_nodes" USING gin ("search_tsv");