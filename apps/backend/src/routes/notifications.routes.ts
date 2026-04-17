/**
 * @fileoverview routes/notifications.routes.
 *
 * High-level purpose:
 * HTTP route surface that validates requests and delegates business logic to services.
 *
 * Key Features (and trade-offs):
 * - Schema-driven request validation and response normalization.
 * - Auth/rate-limit aware route composition for API boundaries.
 * - Thin handlers that preserve routes -> services -> repositories layering.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Add new endpoints by pairing route handlers with schemas.
 * 3. Delegate business decisions to service layer components.
 * 4. Verify contract changes with API and route tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { Router } from 'express';
import { NotificationService } from '../services/notifications/notification.service';
import { eventBus, EventTypes } from '../services/notifications/event.service';
import { PushService } from '../services/notifications/push.service';

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

router.get('/push/public-key', (_req, res) => {
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
