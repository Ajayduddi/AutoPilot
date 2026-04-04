/**
 * @fileoverview repositories/auth-session.repo.
 *
 * Persistence helpers for user authentication session lifecycle.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { authSessions } from '../db/schema';

/**
 * AuthSessionRepo exported constant.
 */
export const AuthSessionRepo = {
  async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }) {
    const [created] = await db.insert(authSessions).values({
      id: `ses_${randomUUID()}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent || null,
      ip: input.ip || null,
    }).returning();
    return created;
  },

  /** Returns the active, non-expired session matching a token hash. */
  async getActiveByTokenHash(tokenHash: string) {
    return db.query.authSessions.findFirst({
      where: and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    });
  },

  /** Updates the last-seen timestamp for an existing session. */
  async touch(sessionId: string) {
    await db.update(authSessions).set({ lastSeenAt: new Date() }).where(eq(authSessions.id, sessionId));
  },

  /** Revokes a session by session ID. */
  async revokeById(sessionId: string) {
    await db.update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, sessionId));
  },

  /** Revokes sessions that match the given token hash. */
  async revokeByTokenHash(tokenHash: string) {
    await db.update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.tokenHash, tokenHash));
  },

  /** Revokes all active sessions for a user, optionally preserving one session ID. */
  async revokeAllForUserExceptSession(userId: string, sessionId?: string | null) {
    const sessions = await db.query.authSessions.findMany({
      where: and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)),
    });

    await Promise.all(
      sessions
        .filter((session) => !sessionId || session.id !== sessionId)
        .map((session) =>
          db.update(authSessions)
            .set({ revokedAt: new Date() })
            .where(eq(authSessions.id, session.id)),
        ),
    );
  },
};
