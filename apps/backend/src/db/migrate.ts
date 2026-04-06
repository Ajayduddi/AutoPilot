import { migrate as runMigrations } from 'drizzle-orm/postgres-js/migrator';
import { closeDbConnection, db, dbClient } from './index';

declare const Bun: {
  file(path: string | URL): {
    text(): Promise<string>;
  };
  CryptoHasher: new (algorithm: 'sha256') => {
    update(data: string): { digest(format: 'hex'): string };
  };
};

const MIGRATIONS_DIR = decodeURIComponent(
  new URL('./migrations', import.meta.url).pathname,
);
const MIGRATION_JOURNAL_URL = new URL('./migrations/meta/_journal.json', import.meta.url);

async function loadMigrationJournal() {
  const journalRaw = await Bun.file(MIGRATION_JOURNAL_URL).text();
  const journal = JSON.parse(journalRaw) as {
    entries?: Array<{ tag: string; when: number }>;
  };

  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error('Migration journal has no entries.');
  }

  const latest = [...journal.entries].sort((a, b) => b.when - a.when)[0];
  const sqlUrl = new URL(`./migrations/${latest.tag}.sql`, import.meta.url);
  const migrationSql = await Bun.file(sqlUrl).text();
  const hash = new Bun.CryptoHasher('sha256').update(migrationSql).digest('hex');

  return {
    latestTag: latest.tag,
    latestMillis: latest.when,
    latestHash: hash,
  };
}

async function getSchemaState() {
  const tables = await dbClient<Array<{ count: number }>>`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'public'
  `;
  const publicTableCount = tables[0]?.count ?? 0;

  const drizzleSchema = await dbClient<Array<{ exists: boolean }>>`
    select exists(select 1 from information_schema.schemata where schema_name = 'drizzle') as exists
  `;

  let migrationsRows = 0;
  if (drizzleSchema[0]?.exists) {
    const migrationsTable = await dbClient<Array<{ exists: boolean }>>`
      select to_regclass('drizzle.__drizzle_migrations') is not null as exists
    `;
    if (migrationsTable[0]?.exists) {
      const rowCount = await dbClient<Array<{ count: number }>>`
        select count(*)::int as count from drizzle.__drizzle_migrations
      `;
      migrationsRows = rowCount[0]?.count ?? 0;
    }
  }

  const publicTables = await dbClient<Array<{ table_name: string }>>`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
  `;

  return { publicTableCount, migrationsRows, publicTableNames: publicTables.map((r) => r.table_name) };
}

function printMigrationError(error: unknown) {
  const err = error as Record<string, unknown>;
  console.error('[db:migrate] Migration failed.');
  if (err?.message) console.error(`[db:migrate] message: ${String(err.message)}`);
  if (err?.code) console.error(`[db:migrate] code: ${String(err.code)}`);
  if (err?.detail) console.error(`[db:migrate] detail: ${String(err.detail)}`);
  if (err?.schema_name) console.error(`[db:migrate] schema: ${String(err.schema_name)}`);
  if (err?.table_name) console.error(`[db:migrate] table: ${String(err.table_name)}`);
  if (err?.constraint_name) console.error(`[db:migrate] constraint: ${String(err.constraint_name)}`);
  if (err?.routine) console.error(`[db:migrate] routine: ${String(err.routine)}`);
}

async function baselineIfNeeded() {
  const state = await getSchemaState();
  if (state.publicTableCount === 0 || state.migrationsRows > 0) {
    return false;
  }

  const requiredTables = [
    'users',
    'chat_threads',
    'chat_messages',
    'workflows',
    'workflow_runs',
    'approvals',
    'notifications',
    'provider_configs',
    'user_connections',
    'webhook_secrets',
    'push_subscriptions',
    'auth_sessions',
    'context_memory',
    'chat_attachments',
    'chat_attachment_chunks',
  ];

  const existingTables = new Set(state.publicTableNames);
  const missing = requiredTables.filter((tableName) => !existingTables.has(tableName));
  if (missing.length > 0) {
    throw new Error(
      `[db:migrate] Refusing automatic baseline: schema is partially initialized and missing required tables (${missing.join(
        ', ',
      )}). Run explicit repair/bootstrap before retrying.`,
    );
  }

  const { latestTag, latestMillis, latestHash } = await loadMigrationJournal();
  console.warn(
    `[db:migrate] Detected schema-without-migration-history drift (public tables=${state.publicTableCount}, drizzle rows=0).`,
  );
  console.warn(`[db:migrate] Baseline marker will be set to latest migration tag: ${latestTag}.`);

  await dbClient`create schema if not exists drizzle`;
  await dbClient`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `;

  const existingRows = await dbClient<Array<{ count: number }>>`
    select count(*)::int as count from drizzle.__drizzle_migrations
  `;
  if ((existingRows[0]?.count ?? 0) === 0) {
    await dbClient`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${latestHash}, ${latestMillis})
    `;
    console.warn('[db:migrate] Baseline marker inserted. Re-running migrations.');
  }

  return true;
}

async function main() {
  try {
    await runMigrations(db, { migrationsFolder: MIGRATIONS_DIR });
    console.log('[db:migrate] Migrations applied successfully.');
  } catch (error) {
    printMigrationError(error);
    const baselined = await baselineIfNeeded();
    if (!baselined) {
      throw error;
    }

    await runMigrations(db, { migrationsFolder: MIGRATIONS_DIR });
    console.log('[db:migrate] Migrations completed after baseline recovery.');
  } finally {
    await closeDbConnection(5);
  }
}

main().catch((error) => {
  printMigrationError(error);
  process.exit(1);
});
