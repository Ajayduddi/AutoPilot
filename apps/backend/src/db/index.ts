/**
 * @fileoverview Database client bootstrap and lifecycle utilities.
 *
 * Creates the shared Drizzle client and exposes low-level Postgres access for
 * scripts/utilities that require direct driver operations.
 *
 * @remarks
 * This module is the single source of truth for backend DB connection setup.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

/**
 * Resolved PostgreSQL connection string used by Drizzle + `postgres`.
 *
 * @remarks
 * Falls back to local development defaults when `DATABASE_URL` is not set.
 */
const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/chat_automation';

// Disable prefetch as it causes strict mode issues in generic pooling, though fine for Postgres locally
const client = postgres(connectionString, { prepare: false });

/**
 * Primary Drizzle database client bound to the full schema.
 *
 * @remarks
 * Import this in repositories/services for type-safe SQL operations.
 *
 * @example
 * ```ts
 * import { db } from '../db';
 * import { users } from '../db/schema';
 *
 * const allUsers = await db.select().from(users);
 * ```
 */
export const db = drizzle(client, { schema });

/**
 * Low-level `postgres` client for operations outside Drizzle's query builder.
 *
 * @remarks
 * Prefer {@link db} for normal CRUD paths; use this for driver-level tasks only.
 */
export const dbClient = client;

/**
 * Closes the active PostgreSQL connection pool during graceful shutdown.
 *
 * @param timeoutSeconds - Maximum wait time before force-ending connections.
 * @returns Promise resolved once pool shutdown completes.
 *
 * @example
 * ```ts
 * await closeDbConnection(10);
 * ```
 */
export async function closeDbConnection(timeoutSeconds = 10): Promise<void> {
  await client.end({ timeout: timeoutSeconds });
}
