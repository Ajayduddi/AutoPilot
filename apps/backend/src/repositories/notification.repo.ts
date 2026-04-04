/**
 * @fileoverview repositories/notification.repo.
 *
 * Persistence helpers for user notification creation and lifecycle operations.
 */
import { and, eq, desc, lt } from 'drizzle-orm';
import { db } from '../db';
import { notifications } from '../db/schema';
import { randomUUID } from 'crypto';

/**
 * NotificationRepo exported constant.
 */
export const NotificationRepo = {
    async createNotification(userId: string, data: { type: 'workflow_event' | 'approval_request' | 'system', title: string, message?: string, runId?: string, payload?: any }) {
        const id = `notif_${randomUUID()}`;
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

    async deleteAllForUser(userId: string) {
        const deleted = await db.delete(notifications)
      .where(eq(notifications.userId, userId))
      .returning({ id: notifications.id });
    return deleted.length;
  }
};
