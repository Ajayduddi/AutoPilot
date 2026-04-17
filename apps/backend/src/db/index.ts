/**
 * @fileoverview Database client bootstrap and lifecycle utilities.
 *
 * High-level purpose:
 * Database schema, bootstrap, and operational safety helpers for persistence runtime.
 *
 * Key Features (and trade-offs):
 * - Defines schema/migration/seed and lifecycle utilities.
 * - Supports preflight and integrity checks for production safety.
 * - Provides shared DB access primitives for repositories.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Follow migration safety workflow before schema changes.
 * 3. Keep destructive operations guarded and explicit.
 * 4. Validate with DB preflight/typecheck as applicable.
 * 5. Keep documentation aligned with behavior and tests.
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
