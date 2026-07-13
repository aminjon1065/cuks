CREATE TABLE "app"."file_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"node_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."file_links" ADD CONSTRAINT "file_links_node_id_fs_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "app"."fs_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_links" ADD CONSTRAINT "file_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_links_token_uq" ON "app"."file_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "file_links_node_idx" ON "app"."file_links" USING btree ("node_id");