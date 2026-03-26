import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { notifications } from '../db/schema';

export const NotificationRepo = {
  async createNotification(userId: string, data: { type: 'workflow_event' | 'approval_request' | 'system', title: string, message?: string, runId?: string, payload?: any }) {
    const id = `notif_${Date.now()}`;
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

  async getUserNotifications(userId: string) {
    return await db.query.notifications.findMany({
      where: eq(notifications.userId, userId),
      orderBy: [desc(notifications.createdAt)],
    });
  },

  async markAsRead(notificationId: string) {
    const [notif] = await db.update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, notificationId))
      .returning();
    return notif;
  }
};
