CREATE TABLE "app"."acquaintance_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"resolution_id" uuid,
	"route_step_id" uuid,
	"kind" text NOT NULL,
	"release_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"released_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."resolution_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"resolution_type_id" uuid,
	"text" text NOT NULL,
	"signer_id" uuid NOT NULL,
	"responsible_executor_id" uuid,
	"co_executor_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"acquaint_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"due_at" timestamp with time zone,
	"is_control" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_for" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"resolution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."resolution_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_tj" text NOT NULL,
	"action_kind" text DEFAULT 'execute' NOT NULL,
	"requires_due_at" boolean DEFAULT false NOT NULL,
	"requires_executor" boolean DEFAULT true NOT NULL,
	"requires_outgoing_response" boolean DEFAULT false NOT NULL,
	"default_control" boolean DEFAULT false NOT NULL,
	"default_due_hours" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."acquaintances" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."acquaintances" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."acquaintances" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD COLUMN "available_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD COLUMN "return_comment" text;--> statement-breakpoint
ALTER TABLE "app"."acquaintance_batches" ADD CONSTRAINT "acquaintance_batches_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."acquaintance_batches" ADD CONSTRAINT "acquaintance_batches_resolution_id_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "app"."resolutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."acquaintance_batches" ADD CONSTRAINT "acquaintance_batches_route_step_id_route_steps_id_fk" FOREIGN KEY ("route_step_id") REFERENCES "app"."route_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."acquaintance_batches" ADD CONSTRAINT "acquaintance_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolution_proposals" ADD CONSTRAINT "resolution_proposals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolution_proposals" ADD CONSTRAINT "resolution_proposals_resolution_type_id_resolution_types_id_fk" FOREIGN KEY ("resolution_type_id") REFERENCES "app"."resolution_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolution_proposals" ADD CONSTRAINT "resolution_proposals_signer_id_users_id_fk" FOREIGN KEY ("signer_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolution_proposals" ADD CONSTRAINT "resolution_proposals_responsible_executor_id_users_id_fk" FOREIGN KEY ("responsible_executor_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolution_proposals" ADD CONSTRAINT "resolution_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolution_proposals" ADD CONSTRAINT "resolution_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolution_proposals" ADD CONSTRAINT "resolution_proposals_decided_for_users_id_fk" FOREIGN KEY ("decided_for") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolution_proposals" ADD CONSTRAINT "resolution_proposals_resolution_id_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "app"."resolutions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acquaintance_batches_document_idx" ON "app"."acquaintance_batches" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "acquaintance_batches_release_idx" ON "app"."acquaintance_batches" USING btree ("release_at") WHERE "app"."acquaintance_batches"."released_at" is null and "app"."acquaintance_batches"."release_at" is not null;--> statement-breakpoint
CREATE INDEX "resolution_proposals_document_idx" ON "app"."resolution_proposals" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "resolution_proposals_signer_idx" ON "app"."resolution_proposals" USING btree ("signer_id","status") WHERE "app"."resolution_proposals"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "resolution_types_code_uq" ON "app"."resolution_types" USING btree ("code");--> statement-breakpoint
CREATE INDEX "resolution_types_pick_idx" ON "app"."resolution_types" USING btree ("is_active","sort_order");--> statement-breakpoint
ALTER TABLE "app"."acquaintances" ADD CONSTRAINT "acquaintances_batch_id_acquaintance_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "app"."acquaintance_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD CONSTRAINT "resolutions_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resolutions_available_idx" ON "app"."resolutions" USING btree ("available_at");