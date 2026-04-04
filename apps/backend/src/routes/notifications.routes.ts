/**
 * @fileoverview routes/notifications.routes.
 *
 * HTTP endpoints, request validation, and response composition for API resources.
 */
import { Router } from 'express';
import { NotificationService } from '../services/notification.service';
import { eventBus, EventTypes } from '../services/event.service';
import { PushService } from '../services/push.service';

const router = Router();

// Server-Sent Events (SSE) Stream
router.get('/stream', (req, res) => {
    const userId = req.auth!.user.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Initial connection ping
  res.write('data: {"type": "ping"}\n\n');

    const onNotification = (data: any) => {
    if (data?.userId && data.userId !== userId) return;
    res.write(`data: ${JSON.stringify({ type: 'notification', data })}\n\n`);
  };

    const onWorkflowUpdate = (data: any) => {
    if (data?.userId && data.userId !== userId) return;
    res.write(`data: ${JSON.stringify({ type: 'workflow_update', data })}\n\n`);
  };

  eventBus.on(EventTypes.NOTIFICATION_CREATED, onNotification);
  eventBus.on(EventTypes.WORKFLOW_RUN_UPDATED, onWorkflowUpdate);

  req.on('close', () => {
    eventBus.off(EventTypes.NOTIFICATION_CREATED, onNotification);
    eventBus.off(EventTypes.WORKFLOW_RUN_UPDATED, onWorkflowUpdate);
  });
});

// List notifications inbox
router.get('/', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const limit = req.query.limit ? Math.max(1, Math.min(200, Number(req.query.limit))) : 50;
        const before = typeof req.query.before === 'string' ? req.query.before : undefined;
        const notifications = await NotificationService.getUnread(userId, { limit, before });
        const nextCursor = notifications.length >= limit
      ? notifications[notifications.length - 1]?.createdAt
      : null;
    res.json({ status: 'ok', data: notifications, meta: { limit, nextCursor } });
  } catch (err) {
    next(err);
  }
});

router.get('/push/public-key', (req, res) => {
    const publicKey = PushService.getPublicKey();
  res.json({ status: 'ok', data: { publicKey } });
});

router.post('/push/subscribe', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const sub = req.body;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return res.status(400).json({ error: 'Invalid push subscription payload' });
    }

        const saved = await PushService.subscribe(userId, {
      endpoint: String(sub.endpoint),
      keys: {
        p256dh: String(sub.keys.p256dh),
        auth: String(sub.keys.auth),
      },
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    });
    res.json({ status: 'ok', data: saved });
  } catch (err) {
    next(err);
  }
});

router.post('/push/unsubscribe', async (req, res, next) => {
  try {
        const endpoint = req.body?.endpoint;
    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint' });
    }
        const revoked = await PushService.unsubscribe(String(endpoint));
    res.json({ status: 'ok', data: revoked || null });
  } catch (err) {
    next(err);
  }
});

router.post('/push/test', async (req, res, next) => {
  try {
    await PushService.sendToUser(req.auth!.user.id, {
      title: 'AutoPilot Push Test',
      body: 'Push notifications are enabled successfully.',
      url: '/notifications',
      tag: `push-test-${Date.now()}`,
      data: { kind: 'push_test' },
    });
    res.json({ status: 'ok', data: { sent: true } });
  } catch (err) {
    next(err);
  }
});

// Mark notification as read
router.post('/:id/read', async (req, res, next) => {
  try {
    const { id } = req.params;
        const notification = await NotificationService.markAsRead(id, req.auth!.user.id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ status: 'ok', data: notification });
  } catch (err) {
    next(err);
  }
});

// Mark all notifications as read
router.post('/read-all', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const readCount = await NotificationService.markAllAsRead(userId);
    res.json({ status: 'ok', data: { readCount } });
  } catch (err) {
    next(err);
  }
});

// Clear all notifications for the current user
router.delete('/', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const deletedCount = await NotificationService.clearAll(userId);
    res.json({ status: 'ok', data: { deletedCount } });
  } catch (err) {
    next(err);
  }
});

/**
 * Notifications router for SSE delivery, inbox state, and push subscription APIs.
 *
 * @remarks
 * Mounted at `/api/notifications` behind `requireAuth` in backend bootstrap.
 */
export { router as notificationsRouter };
