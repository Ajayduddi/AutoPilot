/**
 * @fileoverview index.
 *
 * Backend bootstrap, middleware wiring, route registration, and graceful shutdown.
 */
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
import { csrfMiddleware } from './middleware/csrf.middleware';
import { rateLimit } from './middleware/rate-limit.middleware';
import { UserRepo } from './repositories/user.repo';
import { getRuntimeConfig } from './config/runtime.config';
import { securityHeadersMiddleware } from './middleware/security-headers.middleware';
import { logger } from './util/logger';
import { closeDbConnection } from './db';
import { flushMetricsExporter, stopMetricsExporter } from './util/metrics';
import type { Server } from 'http';

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
  if (!process.env.DATABASE_URL) {
    missing.push('DATABASE_URL');
  }
  if (!process.env.PROVIDER_API_KEY_ENCRYPTION_KEY || process.env.PROVIDER_API_KEY_ENCRYPTION_KEY.trim().length < 32) {
    missing.push('PROVIDER_API_KEY_ENCRYPTION_KEY(>=32 chars)');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
  }
}

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.disable('x-powered-by');
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(securityHeadersMiddleware);
app.use(authMiddleware);
app.use(csrfMiddleware);
app.use(rateLimit({ keyPrefix: 'global-api', limit: 1200, windowMs: 60_000 }));
app.use(traceMiddleware);

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

/**
 * Builds the absolute path to the frontend `index.html` file.
 *
 * @param dir - Static frontend directory path.
 * @returns Normalized `index.html` path.
 */
function buildStaticIndexPath(dir: string): string {
  const normalized = dir.replace(/\/+$/, '');
  return `${normalized}/index.html`;
}

/**
 * Registers static frontend serving and SPA fallback route.
 *
 * @param staticFrontendDir - Directory containing built frontend assets.
 */
function registerStaticFrontend(staticFrontendDir: string) {
  app.use(express.static(staticFrontendDir, {
    index: false,
    maxAge: IS_PROD ? '1h' : 0,
    immutable: IS_PROD,
  }));

  app.get('*', (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/') || req.path === '/api' || req.path.startsWith('/health')) return next();
    const indexPath = buildStaticIndexPath(staticFrontendDir);
    res.sendFile(indexPath, (err) => {
      if (err) next();
    });
  });
}

type BunRuntime = {
  file: (path: string) => { exists: () => Promise<boolean> };
};

// Must be the last middleware
app.use(errorMiddleware);

let server: Server | null = null;
let shuttingDown = false;

/**
 * Gracefully stops HTTP server, metrics exporter, and DB connections.
 *
 * @param signal - OS signal initiating shutdown.
 */
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn({ scope: "bootstrap", message: `Received ${signal}. Starting graceful shutdown.` });

  try {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      // Force-close safeguard so deploys don't hang forever.
      setTimeout(() => resolve(), 15_000).unref();
    });
  } catch (err) {
    logger.error({ scope: "bootstrap", message: "Error while closing HTTP server", err });
  }

  try {
    await flushMetricsExporter();
  } catch (err) {
    logger.warn({ scope: "bootstrap", message: "Failed to flush metrics exporter before shutdown", err });
  }
  try {
    stopMetricsExporter();
  } catch (err) {
    logger.warn({ scope: "bootstrap", message: "Failed to stop metrics exporter cleanly", err });
  }

  try {
    await closeDbConnection(10);
  } catch (err) {
    logger.error({ scope: "bootstrap", message: "Error while closing DB connection", err });
  }

  logger.info({ scope: "bootstrap", message: "Graceful shutdown complete" });
  process.exit(0);
}

/**
 * Bootstraps app prerequisites and starts the HTTP server.
 *
 * @throws {Error} When schema initialization or server startup fails.
 */
async function bootstrap() {
  await UserRepo.initSchemaIfNeeded();
  const staticFrontendDir = process.env.FRONTEND_STATIC_DIR?.trim();
  if (staticFrontendDir) {
    const indexPath = buildStaticIndexPath(staticFrontendDir);
    const bunRuntime = (globalThis as { Bun?: BunRuntime }).Bun;
    const staticIndexExists = bunRuntime ? await bunRuntime.file(indexPath).exists() : false;
    if (staticIndexExists) {
      logger.info({ scope: 'bootstrap', message: 'Serving static frontend from backend', staticFrontendDir });
      registerStaticFrontend(staticFrontendDir);
    } else {
      logger.warn({ scope: 'bootstrap', message: 'FRONTEND_STATIC_DIR configured but index.html missing; skipping static serving', staticFrontendDir, indexPath });
    }
  }
  const runtime = getRuntimeConfig();
  server = app.listen(PORT, () => {
    logger.info({ scope: "bootstrap", message: `Backend orchestrator listening on port ${PORT}` });
    logger.info({ scope: "runtime", message: "Runtime loaded", configPath: runtime.configPath, forceInteractiveQuestions: runtime.forceInteractiveQuestions, uploadDir: runtime.uploadDir });
  });
}

bootstrap().catch((err) => {
  logger.error({ scope: "bootstrap", message: "Failed to bootstrap backend", err });
  process.exit(1);
});

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
