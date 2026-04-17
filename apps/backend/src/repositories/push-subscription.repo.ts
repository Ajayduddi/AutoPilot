/**
 * @fileoverview repositories/push-subscription.repo.
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
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { pushSubscriptions } from '../db/schema';

/**
 * PushSubscriptionInput type contract.
 */
export interface PushSubscriptionInput {
    endpoint: string;
  keys: {
        p256dh: string;
        auth: string;
  };
  userAgent?: string;
}

/**
 * PushSubscriptionRepo exported constant.
 */
export const PushSubscriptionRepo = {
    async upsertForUser(userId: string, sub: PushSubscriptionInput) {
        const existing = await db.query.pushSubscriptions.findFirst({
      where: eq(pushSubscriptions.endpoint, sub.endpoint),
    });

    if (existing) {
      const [updated] = await db.update(pushSubscriptions)
        .set({
          userId,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          userAgent: sub.userAgent ?? null,
          revokedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(pushSubscriptions.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(pushSubscriptions).values({
      id: `psub_${crypto.randomUUID()}`,
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: sub.userAgent ?? null,
    }).returning();
    return created;
  },

    async getActiveByUser(userId: string) {
    return db.query.pushSubscriptions.findMany({
      where: and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)),
    });
  },

    async revokeByEndpoint(endpoint: string) {
    const [revoked] = await db.update(pushSubscriptions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .returning();
    return revoked;
  },

    async touch(endpoint: string) {
    await db.update(pushSubscriptions)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(pushSubscriptions.endpoint, endpoint));
  },
};
