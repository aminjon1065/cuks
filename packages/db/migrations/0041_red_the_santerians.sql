CREATE TABLE "app"."chat_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"topic" text,
	"org_unit_id" uuid,
	"created_by" uuid,
	"is_archived" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."chat_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"member_role" text DEFAULT 'member' NOT NULL,
	"last_read_message_id" uuid,
	"notify_level" text DEFAULT 'all' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."chat_pins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"pinned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."chat_reactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."chat_channels" ADD CONSTRAINT "chat_channels_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "app"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_channels" ADD CONSTRAINT "chat_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_members" ADD CONSTRAINT "chat_members_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "app"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_members" ADD CONSTRAINT "chat_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_pins" ADD CONSTRAINT "chat_pins_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "app"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_pins" ADD CONSTRAINT "chat_pins_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_reactions" ADD CONSTRAINT "chat_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_channels_org_unit_uq" ON "app"."chat_channels" USING btree ("org_unit_id") WHERE "app"."chat_channels"."kind" = 'org' and "app"."chat_channels"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "chat_channels_kind_idx" ON "app"."chat_channels" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "chat_channels_last_message_idx" ON "app"."chat_channels" USING btree ("last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_members_channel_user_uq" ON "app"."chat_members" USING btree ("channel_id","user_id");--> statement-breakpoint
CREATE INDEX "chat_members_user_idx" ON "app"."chat_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_pins_channel_message_uq" ON "app"."chat_pins" USING btree ("channel_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reactions_uq" ON "app"."chat_reactions" USING btree ("message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "chat_reactions_message_idx" ON "app"."chat_reactions" USING btree ("message_id");