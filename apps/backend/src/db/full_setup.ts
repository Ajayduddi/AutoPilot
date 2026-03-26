import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not found");

const sql = postgres(url);

async function run() {
  try {
    console.log("Creating full database schema...");
    
    await sql`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" text PRIMARY KEY NOT NULL,
        "email" text UNIQUE NOT NULL,
        "name" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "chat_threads" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "title" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "chat_messages" (
        "id" text PRIMARY KEY NOT NULL,
        "thread_id" text NOT NULL,
        "role" text NOT NULL,
        "content" text,
        "blocks" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "workflows" (
        "key" text PRIMARY KEY NOT NULL,
        "display_name" text NOT NULL,
        "description" text,
        "requires_approval" boolean DEFAULT false NOT NULL,
        "enabled" boolean DEFAULT true NOT NULL,
        "n8n_webhook_url" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "workflow_runs" (
        "id" text PRIMARY KEY NOT NULL,
        "workflow_key" text NOT NULL REFERENCES "workflows"("key"),
        "user_id" text NOT NULL REFERENCES "users"("id"),
        "thread_id" text REFERENCES "chat_threads"("id"),
        "status" text DEFAULT 'running' NOT NULL,
        "result_payload" jsonb,
        "error_payload" jsonb,
        "started_at" timestamp DEFAULT now() NOT NULL,
        "completed_at" timestamp
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "approvals" (
        "id" text PRIMARY KEY NOT NULL,
        "run_id" text NOT NULL REFERENCES "workflow_runs"("id"),
        "user_id" text NOT NULL REFERENCES "users"("id"),
        "status" text DEFAULT 'pending' NOT NULL,
        "summary" text NOT NULL,
        "details" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "resolved_at" timestamp
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "users"("id"),
        "run_id" text REFERENCES "workflow_runs"("id"),
        "type" text NOT NULL,
        "title" text NOT NULL,
        "message" text,
        "read" boolean DEFAULT false NOT NULL,
        "data" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "provider_configs" (
        "id" text PRIMARY KEY NOT NULL,
        "provider" text NOT NULL,
        "model" text NOT NULL,
        "api_key" text,
        "is_default" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "user_connections" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "users"("id"),
        "provider" text NOT NULL,
        "credentials" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
    `;

    console.log("Full Schema Creation Success.");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await sql.end();
  }
}

run();
