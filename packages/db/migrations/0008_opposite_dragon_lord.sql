CREATE TABLE "app"."file_link_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."file_link_grants" ADD CONSTRAINT "file_link_grants_link_id_file_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "app"."file_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_link_grants" ADD CONSTRAINT "file_link_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_link_grants" ADD CONSTRAINT "file_link_grants_node_id_fs_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "app"."fs_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_link_grants_link_user_uq" ON "app"."file_link_grants" USING btree ("link_id","user_id");--> statement-breakpoint
CREATE INDEX "file_link_grants_user_node_idx" ON "app"."file_link_grants" USING btree ("user_id","node_id");