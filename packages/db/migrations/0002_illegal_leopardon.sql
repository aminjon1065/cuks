CREATE TABLE "app"."totp_backup_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."totp_backup_codes" ADD CONSTRAINT "totp_backup_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "totp_backup_codes_user_hash_uq" ON "app"."totp_backup_codes" USING btree ("user_id","code_hash");--> statement-breakpoint
CREATE INDEX "totp_backup_codes_user_idx" ON "app"."totp_backup_codes" USING btree ("user_id");