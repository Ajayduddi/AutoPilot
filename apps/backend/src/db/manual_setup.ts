import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not found");

const sql = postgres(url);

async function run() {
  try {
    console.log("Adding chat tables...");
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

    console.log("Updating workflows table...");
    try {
      await sql`ALTER TABLE "workflows" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;`;
    } catch(e: any) {
      if (e.code !== '42701') console.error(e.message); // ignore duplicate column
    }
    
    try {
      await sql`ALTER TABLE "workflows" ADD COLUMN "n8n_webhook_url" text;`;
    } catch(e: any) {
       if (e.code !== '42701') console.error(e.message);
    }

    console.log("Migration manual success.");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await sql.end();
  }
}

run();
