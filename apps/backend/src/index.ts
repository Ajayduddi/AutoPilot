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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(traceMiddleware);

// Load endpoints
app.use('/health', healthRouter);
app.use('/api/chat', chatRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/workflow-runs', workflowRunsRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/settings', settingsRouter);

// Must be the last middleware
app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`Backend orchestrator listening on port ${PORT}`);
});
