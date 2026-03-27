import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health';
import { chatRouter } from './routes/chat.routes';
import { workflowsRouter } from './routes/workflows.routes';
import { approvalsRouter } from './routes/approvals.routes';
import { notificationsRouter } from './routes/notifications.routes';
import { webhooksRouter } from './routes/webhooks.routes';
import { workflowRunsRouter } from './routes/workflow-runs.routes';
import { settingsRouter } from './routes/settings.routes';
import { traceMiddleware } from './middleware/trace.middleware';
import { errorMiddleware } from './middleware/error.middleware';
import { authRouter } from './routes/auth.routes';
import { authMiddleware, requireAuth } from './middleware/auth.middleware';
import { rateLimit } from './middleware/rate-limit.middleware';

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD) {
  const missing: string[] = [];
  if (!process.env.AUTH_COOKIE_SECRET || process.env.AUTH_COOKIE_SECRET === 'dev_auth_secret_change_me') {
    missing.push('AUTH_COOKIE_SECRET');
  }
  if (!process.env.FRONTEND_ORIGIN) {
    missing.push('FRONTEND_ORIGIN');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
  }
}

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true,
}));
app.use(express.json());
app.use(rateLimit({ keyPrefix: 'global-api', limit: 1200, windowMs: 60_000 }));
app.use(traceMiddleware);
app.use(authMiddleware);

// Load endpoints
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/chat', requireAuth, chatRouter);
app.use('/api/workflows', requireAuth, workflowsRouter);
app.use('/api/workflow-runs', requireAuth, workflowRunsRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/notifications', requireAuth, notificationsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/settings', requireAuth, settingsRouter);

// Must be the last middleware
app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`Backend orchestrator listening on port ${PORT}`);
});
