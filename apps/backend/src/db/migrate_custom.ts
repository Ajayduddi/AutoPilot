import { db } from './index';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql`ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS base_url text`);
  console.log('Migration applied');
  process.exit(0);
}
main();
