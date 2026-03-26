// Direct SQL migration for Stage 1 schema changes.
// Run with: bun run src/db/migrate-schema.ts

import 'dotenv/config';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function migrate() {
  console.log("Starting schema migration...");

  // ── Workflows table ──────────────────────────────────────────
  // Drop old columns and constraints, add new columns
  
  try {
    // 1. Drop old primary key constraint on 'key'
    await sql`ALTER TABLE workflows DROP CONSTRAINT IF EXISTS workflows_pkey CASCADE`;
    console.log("  ✓ Dropped old PK constraint");
  } catch (e) { console.log("  • Old PK already removed"); }

  try {
    // 2. Add new UUID id column if not exists
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid()`;
    // Fill in UUIDs for existing rows
    await sql`UPDATE workflows SET id = gen_random_uuid() WHERE id IS NULL`;
    // Make it NOT NULL and PK
    await sql`ALTER TABLE workflows ALTER COLUMN id SET NOT NULL`;
    await sql`ALTER TABLE workflows ADD PRIMARY KEY (id)`;
    console.log("  ✓ Added UUID id column as PK");
  } catch (e) { console.log("  • id column already exists:", (e as Error).message); }

  try {
    // 3. Add 'name' column (migrate from display_name)
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS name TEXT`;
    await sql`UPDATE workflows SET name = COALESCE(display_name, key) WHERE name IS NULL`;
    await sql`ALTER TABLE workflows ALTER COLUMN name SET NOT NULL`;
    console.log("  ✓ Added name column (populated from display_name)");
  } catch (e) { console.log("  • name:", (e as Error).message); }

  try {
    // 4. Add provider-related columns
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'n8n'`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS owner_user_id TEXT`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS trigger_method TEXT NOT NULL DEFAULT 'webhook'`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS auth_type TEXT NOT NULL DEFAULT 'none'`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS auth_config JSONB`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS input_schema JSONB`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS output_schema JSONB`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[]`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS metadata JSONB`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS last_run_status TEXT`;
    console.log("  ✓ Added all new workflow columns");
  } catch (e) { console.log("  • New columns:", (e as Error).message); }

  try {
    // 5. Migrate execution_endpoint from n8n_webhook_url
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS execution_endpoint TEXT`;
    await sql`UPDATE workflows SET execution_endpoint = n8n_webhook_url WHERE execution_endpoint IS NULL AND n8n_webhook_url IS NOT NULL`;
    console.log("  ✓ Migrated n8n_webhook_url → execution_endpoint");
  } catch (e) { console.log("  • execution_endpoint:", (e as Error).message); }

  try {
    // 6. Add unique constraint on key
    await sql`ALTER TABLE workflows DROP CONSTRAINT IF EXISTS workflows_key_unique`;
    await sql`ALTER TABLE workflows ADD CONSTRAINT workflows_key_unique UNIQUE (key)`;
    console.log("  ✓ Added unique constraint on key");
  } catch (e) { console.log("  • key unique:", (e as Error).message); }

  try {
    // 7. Ensure timestamps exist
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW() NOT NULL`;
    await sql`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW() NOT NULL`;
    console.log("  ✓ Ensured timestamp columns");
  } catch (e) { console.log("  • timestamps:", (e as Error).message); }

  // ── Workflow Runs table ──────────────────────────────────────
  
  try {
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS workflow_id UUID`;
    // Backfill from workflow_key if possible
    await sql`
      UPDATE workflow_runs SET workflow_id = w.id 
      FROM workflows w 
      WHERE workflow_runs.workflow_key = w.key AND workflow_runs.workflow_id IS NULL
    `;
    console.log("  ✓ Added workflow_id to workflow_runs");
  } catch (e) { console.log("  • workflow_id:", (e as Error).message); }

  try {
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'n8n'`;
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS trace_id TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT`;
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'api'`;
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS input_payload JSONB`;
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS normalized_output JSONB`;
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS raw_provider_response JSONB`;
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP`;
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`;
    await sql`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`;
    console.log("  ✓ Added all new workflow_runs columns");
  } catch (e) { console.log("  • workflow_runs columns:", (e as Error).message); }

  // ── Users table (ensure email unique) ────────────────────────
  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`;
    await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique`;
    await sql`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM users HAVING COUNT(*) > 0) THEN
        ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
      END IF;
    END $$`;
    console.log("  ✓ Users table updated");
  } catch (e) { console.log("  • users:", (e as Error).message); }

  // ── Drop old columns (optional cleanup) ──────────────────────
  try {
    await sql`ALTER TABLE workflows DROP COLUMN IF EXISTS display_name`;
    await sql`ALTER TABLE workflows DROP COLUMN IF EXISTS n8n_webhook_url`;
    await sql`ALTER TABLE workflow_runs DROP COLUMN IF EXISTS result_payload`;
    await sql`ALTER TABLE workflow_runs DROP COLUMN IF EXISTS completed_at`;
    console.log("  ✓ Dropped old columns");
  } catch (e) { console.log("  • Cleanup:", (e as Error).message); }

  console.log("\n✅ Schema migration complete!");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
