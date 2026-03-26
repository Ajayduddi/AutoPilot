import { Router } from 'express';
import { NotificationService } from '../services/notification.service';
import { eventBus, EventTypes } from '../services/event.service';

const router = Router();

// Server-Sent Events (SSE) Stream
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Initial connection ping
  res.write('data: {"type": "ping"}\n\n');

  const onNotification = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'notification', data })}\n\n`);
  };

  const onWorkflowUpdate = (data: any) => {
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
    const userId = "usr_admin";
    const notifications = await NotificationService.getUnread(userId);
    res.json({ status: 'ok', data: notifications });
  } catch (err) {
    next(err);
  }
});

// Mark notification as read
router.post('/:id/read', async (req, res, next) => {
  try {
    const { id } = req.params;
    const notification = await NotificationService.markAsRead(id);
    res.json({ status: 'ok', data: notification });
  } catch (err) {
    next(err);
  }
});

export { router as notificationsRouter };
