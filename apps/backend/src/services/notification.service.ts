import { NotificationRepo } from '../repositories/notification.repo';
import { eventBus, EventTypes } from './event.service';
import { PushService } from './push.service';

function isGenericWorkflowTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  return normalized.startsWith('workflow completed')
    || normalized.startsWith('workflow failed')
    || normalized.startsWith('workflow started')
    || normalized.startsWith('workflow dispatch failed');
}

function toHeadline(text: string, max = 82) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  const headline = firstSentence.replace(/[.:;,\s]+$/, '');
  return headline.length <= max ? headline : `${headline.slice(0, max - 3).trim()}...`;
}

function derivePushTitle(data: { title: string; message?: string; payload?: any }) {
  const fallback = data.title || 'Notification';
  if (!isGenericWorkflowTitle(fallback)) return fallback;

  const summaryFromPayload = typeof data.payload?.summary === 'string' ? data.payload.summary : '';
  const fromSummary = toHeadline(summaryFromPayload);
  if (fromSummary) return fromSummary;

  const fromMessage = toHeadline(data.message || '');
  if (fromMessage) return fromMessage;

  return fallback;
}

function derivePushBody(data: { message?: string; payload?: any }) {
  const summaryFromPayload = typeof data.payload?.summary === 'string' ? data.payload.summary : '';
  const source = summaryFromPayload || data.message || '';
  const oneLine = source.replace(/\s+/g, ' ').trim();
  if (!oneLine) return 'New update available.';
  return oneLine.length <= 140 ? oneLine : `${oneLine.slice(0, 137).trim()}...`;
}

function derivePushTag(data: { type: string; runId?: string; payload?: any }) {
  const workflowKey = typeof data.payload?.workflowKey === 'string' ? data.payload.workflowKey.trim() : '';
  if (workflowKey) return `workflow:${workflowKey.toLowerCase()}`;
  if (data.runId) return `run:${data.runId}`;
  return `type:${data.type}`;
}

function deriveFollowUpUrl(data: { title: string; message?: string; payload?: any }) {
  const summaryFromPayload = typeof data.payload?.summary === 'string' ? data.payload.summary : '';
  const context = (summaryFromPayload || data.message || data.title || '').replace(/\s+/g, ' ').trim();
  const q = context
    ? `Can you explain this result in more detail: ${context}`
    : 'Can you explain this notification in more detail?';
  const draft = encodeURIComponent(`I have a follow-up question.\nContext: ${q}\nMy question: `);
  return `/?draft=${draft}&autosend=1`;
}

export class NotificationService {
  static shouldNotifyWorkflowRun(context: { triggerSource?: string | null; threadId?: string | null }) {
    if (context.threadId) return false;
    return context.triggerSource !== 'ui' && context.triggerSource !== 'chat';
  }

  static async notify(userId: string, data: { type: "system" | "workflow_event" | "approval_request"; title: string; message?: string; runId?: string; payload?: any }) {
    const notification = await NotificationRepo.createNotification(userId, data);
    eventBus.emit(EventTypes.NOTIFICATION_CREATED, notification);
    const tag = derivePushTag(data);
    PushService.sendToUser(userId, {
      title: derivePushTitle(data),
      body: derivePushBody(data),
      url: '/notifications',
      tag,
      data: {
        notificationId: notification.id,
        runId: data.runId,
        type: data.type,
        followUpUrl: deriveFollowUpUrl(data),
        muteTag: tag,
      },
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'ask_followup', title: 'Ask follow-up' },
        { action: 'mute_topic', title: 'Mute' },
      ],
    }).catch((err) => console.warn('[NotificationService] Push send failed:', err));
    return notification;
  }

  static async getUnread(userId: string, opts?: { limit?: number; before?: string }) {
    return NotificationRepo.getUserNotifications(userId, opts);
  }

  static async markAsRead(notificationId: string, userId: string) {
    return NotificationRepo.markAsRead(notificationId, userId);
  }

  static async clearAll(userId: string) {
    return NotificationRepo.deleteAllForUser(userId);
  }
}
