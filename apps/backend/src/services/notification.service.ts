import { NotificationRepo } from '../repositories/notification.repo';
import { eventBus, EventTypes } from './event.service';

export class NotificationService {
  static async notify(userId: string, data: { type: "system" | "workflow_event" | "approval_request"; title: string; message?: string; runId?: string; payload?: any }) {
    const notification = await NotificationRepo.createNotification(userId, data);
    eventBus.emit(EventTypes.NOTIFICATION_CREATED, notification);
    return notification;
  }

  static async getUnread(userId: string) {
    return NotificationRepo.getUserNotifications(userId);
  }

  static async markAsRead(notificationId: string) {
    return NotificationRepo.markAsRead(notificationId);
  }
}
