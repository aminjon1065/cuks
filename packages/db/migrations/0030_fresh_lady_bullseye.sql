CREATE TABLE "app"."resolution_extensions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"resolution_id" uuid NOT NULL,
	"old_due" timestamp with time zone,
	"new_due" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"extended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."resolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" uuid NOT NULL,
	"executor_id" uuid NOT NULL,
	"co_executors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"text" text NOT NULL,
	"due_date" timestamp with time zone,
	"is_control" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"report" text,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."resolution_extensions" ADD CONSTRAINT "resolution_extensions_resolution_id_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "app"."resolutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolution_extensions" ADD CONSTRAINT "resolution_extensions_extended_by_users_id_fk" FOREIGN KEY ("extended_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD CONSTRAINT "resolutions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD CONSTRAINT "resolutions_parent_id_resolutions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."resolutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD CONSTRAINT "resolutions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."resolutions" ADD CONSTRAINT "resolutions_executor_id_users_id_fk" FOREIGN KEY ("executor_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resolution_extensions_resolution_idx" ON "app"."resolution_extensions" USING btree ("resolution_id");--> statement-breakpoint
CREATE INDEX "resolutions_document_idx" ON "app"."resolutions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "resolutions_executor_idx" ON "app"."resolutions" USING btree ("executor_id","status");--> statement-breakpoint
CREATE INDEX "resolutions_co_executors_idx" ON "app"."resolutions" USING gin ("co_executors");