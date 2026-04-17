/**
 * @fileoverview repositories/notification.repo.
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
import { and, eq, desc, lt } from 'drizzle-orm';
import { db } from '../db';
import { notifications } from '../db/schema';

/**
 * NotificationRepo exported constant.
 */
export const NotificationRepo = {
    async createNotification(userId: string, data: { type: 'workflow_event' | 'approval_request' | 'system', title: string, message?: string, runId?: string, payload?: any }) {
        const id = `notif_${crypto.randomUUID()}`;
    const [notif] = await db.insert(notifications).values({
      id,
      userId,
      type: data.type,
      title: data.title,
      message: data.message,
      runId: data.runId,
      data: data.payload,
    }).returning();
    return notif;
  },

  async getUserNotifications(userId: string, opts?: { limit?: number; before?: string }) {
        const limit = Math.max(1, Math.min(200, opts?.limit || 50));
        const where = opts?.before
      ? and(eq(notifications.userId, userId), lt(notifications.createdAt, new Date(opts.before)))
      : eq(notifications.userId, userId);
    return await db.query.notifications.findMany({
      where,
      orderBy: [desc(notifications.createdAt)],
      limit,
    });
  },

    async markAsRead(notificationId: string, userId: string) {
    const [notif] = await db.update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning();
    return notif;
  },

  async markAllAsRead(userId: string) {
    return await db.update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
      .returning({ id: notifications.id });
  },

    async deleteAllForUser(userId: string) {
        const deleted = await db.delete(notifications)
      .where(eq(notifications.userId, userId))
      .returning({ id: notifications.id });
    return deleted.length;
  }
};
