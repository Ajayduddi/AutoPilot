/**
 * @fileoverview repositories/auth-session.repo.
 *
 * High-level purpose:
 * Data access repository layer for persistence operations and query composition.
 *
 * Key Features (and trade-offs):
 * - Typed CRUD/query helpers over Drizzle and database schema.
 * - Centralized data filtering, sorting, and pagination primitives.
 * - Keeps SQL/ORM concerns isolated from route and service layers.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Use repositories from services only, not directly from routes.
 * 3. Keep repository methods deterministic and side-effect scoped.
 * 4. Run database-related tests when query behavior changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
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
    mfaVerifiedAt?: Date | null;
    userAgent?: string | null;
    ip?: string | null;
  }) {
    const [created] = await db.insert(authSessions).values({
      id: `ses_${crypto.randomUUID()}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      mfaVerifiedAt: input.mfaVerifiedAt ?? null,
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

  async markMfaVerified(sessionId: string) {
    await db.update(authSessions)
      .set({ mfaVerifiedAt: new Date(), lastSeenAt: new Date() })
      .where(eq(authSessions.id, sessionId));
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
