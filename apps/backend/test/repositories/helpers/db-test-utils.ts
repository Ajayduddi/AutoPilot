import { eq, sql } from "drizzle-orm";
import { db } from "../../../src/db";
import { authSessions, notifications, users } from "../../../src/db/schema";

export function testId(prefix: string): string {
  return `${prefix}_${Bun.randomUUIDv7()}`;
}

export async function assertDbReachable(): Promise<void> {
  await db.execute(sql`select 1`);
}

export async function createTestUser(input?: { id?: string; email?: string; name?: string }) {
  const id = input?.id || testId("usr");
  const email = input?.email || `${id}@example.test`;
  const name = input?.name || "Test User";
  await db.insert(users).values({
    id,
    email,
    name,
  });
  return { id, email, name };
}

export async function cleanupTestUser(userId: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.userId, userId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

