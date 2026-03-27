import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { authSessions } from '../db/schema';

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

  async getActiveByTokenHash(tokenHash: string) {
    return db.query.authSessions.findFirst({
      where: and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    });
  },

  async touch(sessionId: string) {
    await db.update(authSessions).set({ lastSeenAt: new Date() }).where(eq(authSessions.id, sessionId));
  },

  async revokeById(sessionId: string) {
    await db.update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, sessionId));
  },

  async revokeByTokenHash(tokenHash: string) {
    await db.update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.tokenHash, tokenHash));
  },

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
