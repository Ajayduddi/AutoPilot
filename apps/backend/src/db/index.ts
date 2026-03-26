import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/chat_automation';

// Disable prefetch as it causes strict mode issues in generic pooling, though fine for Postgres locally
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
