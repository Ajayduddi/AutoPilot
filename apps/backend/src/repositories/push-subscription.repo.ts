import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { pushSubscriptions } from '../db/schema';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
}

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
      id: `psub_${randomUUID()}`,
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

