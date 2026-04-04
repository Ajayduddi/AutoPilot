import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { AuthSessionRepo } from "../../src/repositories/auth-session.repo";
import { db } from "../../src/db";
import { authSessions } from "../../src/db/schema";
import { assertDbReachable, cleanupTestUser, createTestUser, testId } from "./helpers/db-test-utils";

const usersToCleanup = new Set<string>();
let dbReady = false;
const dbRequired = process.env.REQUIRE_DB_TESTS === "true";

beforeAll(async () => {
  try {
    await assertDbReachable();
    dbReady = true;
  } catch (error) {
    dbReady = false;
    if (dbRequired) throw error;
    console.warn("[test:db] Skipping AuthSessionRepo DB integration tests (database unavailable).");
  }
});

afterEach(async () => {
  for (const userId of usersToCleanup) {
    await cleanupTestUser(userId);
  }
  usersToCleanup.clear();
});

describe("AuthSessionRepo DB integration", () => {
  it("creates, reads active session, touches, and revokes by id", async () => {
    if (!dbReady) return;

    const user = await createTestUser();
    usersToCleanup.add(user.id);
    const tokenHash = testId("tok");
    const expiresAt = new Date(Date.now() + 60_000);

    const created = await AuthSessionRepo.create({
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: "bun-test",
      ip: "127.0.0.1",
    });
    expect(created.id.startsWith("ses_")).toBe(true);
    expect(created.userId).toBe(user.id);

    const active = await AuthSessionRepo.getActiveByTokenHash(tokenHash);
    expect(active).toBeTruthy();
    expect(active?.revokedAt).toBeNull();

    await AuthSessionRepo.touch(created.id);
    const touched = await db.query.authSessions.findFirst({
      where: eq(authSessions.id, created.id),
    });
    expect(touched?.lastSeenAt).toBeTruthy();

    await AuthSessionRepo.revokeById(created.id);
    const revoked = await db.query.authSessions.findFirst({
      where: eq(authSessions.id, created.id),
    });
    expect(revoked?.revokedAt).toBeTruthy();
  });

  it("revokes all active sessions except the keep session", async () => {
    if (!dbReady) return;

    const user = await createTestUser();
    usersToCleanup.add(user.id);
    const expiresAt = new Date(Date.now() + 120_000);

    const keep = await AuthSessionRepo.create({
      userId: user.id,
      tokenHash: testId("tok_keep"),
      expiresAt,
    });
    const revokeA = await AuthSessionRepo.create({
      userId: user.id,
      tokenHash: testId("tok_a"),
      expiresAt,
    });
    const revokeB = await AuthSessionRepo.create({
      userId: user.id,
      tokenHash: testId("tok_b"),
      expiresAt,
    });

    await AuthSessionRepo.revokeAllForUserExceptSession(user.id, keep.id);

    const stillActive = await db.query.authSessions.findMany({
      where: and(eq(authSessions.userId, user.id), isNull(authSessions.revokedAt)),
    });
    expect(stillActive.length).toBe(1);
    expect(stillActive[0].id).toBe(keep.id);

    const revokedCount = await db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.userId, user.id), isNotNull(authSessions.revokedAt)));
    expect(revokedCount.some((row) => row.id === revokeA.id)).toBe(true);
    expect(revokedCount.some((row) => row.id === revokeB.id)).toBe(true);
  });
});
