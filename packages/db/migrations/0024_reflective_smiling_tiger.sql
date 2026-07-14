CREATE TABLE "app"."gis_db_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gis_db_accounts_kind_chk" CHECK ("app"."gis_db_accounts"."kind" in ('reader', 'editor'))
);
--> statement-breakpoint
ALTER TABLE "gis"."layers" ADD COLUMN "geoserver_layer" text;--> statement-breakpoint
ALTER TABLE "app"."gis_db_accounts" ADD CONSTRAINT "gis_db_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gis_db_accounts_username_uq" ON "app"."gis_db_accounts" USING btree ("username");