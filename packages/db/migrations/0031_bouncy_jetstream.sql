CREATE TABLE "app"."certificates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"kind" text DEFAULT 'device' NOT NULL,
	"device_label" text NOT NULL,
	"public_key_spki" text NOT NULL,
	"subject_username" text NOT NULL,
	"subject_full_name" text NOT NULL,
	"subject_position" text,
	"ca_signature" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."signatures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"doc_version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"route_step_id" uuid,
	"algorithm" text NOT NULL,
	"context" text NOT NULL,
	"payload" text NOT NULL,
	"payload_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."certificates" ADD CONSTRAINT "certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."signatures" ADD CONSTRAINT "signatures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."signatures" ADD CONSTRAINT "signatures_doc_version_id_file_versions_id_fk" FOREIGN KEY ("doc_version_id") REFERENCES "app"."file_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."signatures" ADD CONSTRAINT "signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."signatures" ADD CONSTRAINT "signatures_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "app"."certificates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."signatures" ADD CONSTRAINT "signatures_route_step_id_route_steps_id_fk" FOREIGN KEY ("route_step_id") REFERENCES "app"."route_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_serial_uq" ON "app"."certificates" USING btree ("serial");--> statement-breakpoint
CREATE INDEX "certificates_user_idx" ON "app"."certificates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signatures_document_idx" ON "app"."signatures" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "signatures_doc_version_idx" ON "app"."signatures" USING btree ("doc_version_id");--> statement-breakpoint
CREATE INDEX "signatures_user_idx" ON "app"."signatures" USING btree ("user_id");