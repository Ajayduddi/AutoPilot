CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"blocks" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text,
	"user_id" text,
	"category" text NOT NULL,
	"workflow_run_id" text,
	"workflow_id" text,
	"content" text NOT NULL,
	"summary" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"run_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"read" boolean DEFAULT false NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"api_key" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"credentials" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_key" text NOT NULL,
	"provider" text NOT NULL,
	"trace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text,
	"trigger_source" text DEFAULT 'api' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"input_payload" jsonb,
	"normalized_output" jsonb,
	"raw_provider_response" jsonb,
	"error_payload" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"provider" text DEFAULT 'n8n' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"owner_user_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"trigger_method" text DEFAULT 'webhook' NOT NULL,
	"execution_endpoint" text,
	"http_method" text DEFAULT 'POST' NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"auth_config" jsonb,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"last_run_at" timestamp,
	"last_run_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connections" ADD CONSTRAINT "user_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_context_memory_thread" ON "context_memory" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_context_memory_category" ON "context_memory" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_context_memory_thread_category" ON "context_memory" USING btree ("thread_id","category");--> statement-breakpoint
CREATE INDEX "idx_context_memory_workflow_run" ON "context_memory" USING btree ("workflow_run_id");