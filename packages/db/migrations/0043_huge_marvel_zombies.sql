CREATE TABLE "app"."meet_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"initiator_id" uuid,
	"participants" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"max_concurrent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."meet_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"channel_id" uuid,
	"access" text DEFAULT 'invited' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"livekit_room" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."meetings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid,
	"title" text NOT NULL,
	"agenda" text,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer,
	"organizer_id" uuid,
	"participants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"record_planned" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."recordings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid,
	"meeting_id" uuid,
	"title" text NOT NULL,
	"started_by" uuid,
	"egress_id" text,
	"duration" integer,
	"size" bigint,
	"file_key" text,
	"participants" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."meet_calls" ADD CONSTRAINT "meet_calls_room_id_meet_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."meet_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meet_calls" ADD CONSTRAINT "meet_calls_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meet_rooms" ADD CONSTRAINT "meet_rooms_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "app"."chat_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meet_rooms" ADD CONSTRAINT "meet_rooms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meetings" ADD CONSTRAINT "meetings_room_id_meet_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."meet_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meetings" ADD CONSTRAINT "meetings_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recordings" ADD CONSTRAINT "recordings_room_id_meet_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."meet_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recordings" ADD CONSTRAINT "recordings_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "app"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."recordings" ADD CONSTRAINT "recordings_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meet_calls_room_idx" ON "app"."meet_calls" USING btree ("room_id","started_at");--> statement-breakpoint
CREATE INDEX "meet_calls_participants_idx" ON "app"."meet_calls" USING gin ("participants");--> statement-breakpoint
CREATE UNIQUE INDEX "meet_rooms_slug_uq" ON "app"."meet_rooms" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "meet_rooms_livekit_room_uq" ON "app"."meet_rooms" USING btree ("livekit_room");--> statement-breakpoint
CREATE UNIQUE INDEX "meet_rooms_channel_active_uq" ON "app"."meet_rooms" USING btree ("channel_id") WHERE "app"."meet_rooms"."channel_id" is not null and "app"."meet_rooms"."is_active";--> statement-breakpoint
CREATE INDEX "meetings_starts_idx" ON "app"."meetings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "meetings_organizer_idx" ON "app"."meetings" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "meetings_status_idx" ON "app"."meetings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recordings_meeting_idx" ON "app"."recordings" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "recordings_room_idx" ON "app"."recordings" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "recordings_status_idx" ON "app"."recordings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "recordings_egress_uq" ON "app"."recordings" USING btree ("egress_id") WHERE "app"."recordings"."egress_id" is not null;