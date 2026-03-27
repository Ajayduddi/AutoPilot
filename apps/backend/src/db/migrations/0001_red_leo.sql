CREATE TABLE "webhook_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"secret_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_by_user_id" text,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_secrets_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD CONSTRAINT "webhook_secrets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;