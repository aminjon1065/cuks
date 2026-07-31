CREATE TABLE "app"."document_collaborators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "sender_name" text;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "sender_contact" text;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "recipient_name" text;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "recipient_contact" text;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."document_collaborators" ADD CONSTRAINT "document_collaborators_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_collaborators" ADD CONSTRAINT "document_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_collaborators" ADD CONSTRAINT "document_collaborators_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_collaborators_active_uq" ON "app"."document_collaborators" USING btree ("document_id","user_id","role") WHERE "app"."document_collaborators"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "document_collaborators_document_idx" ON "app"."document_collaborators" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_collaborators_user_idx" ON "app"."document_collaborators" USING btree ("user_id");