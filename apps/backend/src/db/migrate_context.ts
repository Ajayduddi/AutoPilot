/**
 * Run the context_memory migration manually.
 * Usage: bun src/db/migrate_context.ts
 */
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/chat_automation';

async function migrate() {
  const sql = postgres(connectionString);

  try {
    const migrationPath = path.resolve(__dirname, 'migrations/0003_context_memory.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('[migrate_context] Running context_memory migration...');
    await sql.unsafe(migrationSQL);
    console.log('[migrate_context] Migration completed successfully.');
  } catch (err) {
    console.error('[migrate_context] Migration failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrate();
