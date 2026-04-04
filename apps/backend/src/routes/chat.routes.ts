/**
 * @fileoverview routes/chat.routes.
 *
 * HTTP endpoints, request validation, and response composition for API resources.
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.middleware';
import { createThreadSchema, addMessageSchema, renameThreadSchema, answerQuestionSchema } from '../schemas/chat.schema';
import { ChatService } from '../services/chat.service';
import { OrchestratorService } from '../services/orchestrator.service';
import { AgentService } from '../services/agent.service';
import { ChatRepo } from '../repositories/chat.repo';
import { AttachmentProcessingService } from '../services/attachment-processing.service';
import { AttachmentStorageService } from '../services/attachment-storage.service';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { ReActTelemetryAnalyticsService } from '../services/react-telemetry-analytics.service';
import { ContextService } from '../services/context.service';
import { getRuntimeConfig } from '../config/runtime.config';
import { isChatBlocksEnvelope } from '@autopilot/shared';
import { logger } from '../util/logger';
import { incrementCounter } from '../util/metrics';

const router = Router();

const MAX_FILES_PER_MESSAGE = AttachmentProcessingService.getMaxFilesPerMessage();
const MAX_UPLOAD_BYTES = AttachmentProcessingService.getMaxUploadBytes();

/**
 * Normalizes a header value into a single trimmed string.
 *
 * @param value - Header value from Express request headers.
 * @returns First non-empty string value, or `null` when absent.
 */
function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  if (typeof value === 'string') return value.trim() || null;
  return null;
}

/**
 * Dispatches assistant handling through Agent runtime with orchestrator fallback.
 *
 * @param args - Message dispatch inputs and runtime context.
 * @returns Persisted assistant message from either runtime path.
 */
async function dispatchAssistantMessage(args: {
    threadId: string;
    content: string;
    traceId: string;
    userId: string;
  providerId?: string;
  model?: string;
    attachments: any[];
  temporalInput?: { profileTimezone?: string | null; headerTimezone?: string | null };
}) {
  if (AgentService.isEnabled()) {
    try {
      return await AgentService.handleIncomingMessage(
        args.threadId,
        args.content,
        args.traceId,
        args.userId,
        args.providerId,
        args.model,
        args.attachments,
        args.temporalInput,
      );
    } catch (err) {
      logger.warn({
        scope: 'chat.routes',
        message: 'AgentService failed, falling back to orchestrator',
        threadId: args.threadId,
        traceId: args.traceId,
        userId: args.userId,
        err,
      });
    }
  }

  return await OrchestratorService.handleIncomingMessage(
    args.threadId,
    args.content,
    args.traceId,
    args.userId,
    args.providerId,
    args.model,
    args.attachments,
    args.temporalInput,
  );
}

/**
 * Projects attachment rows into client-facing payload shape.
 *
 * @param att - Raw attachment row.
 * @returns Attachment enriched with extraction metadata shortcuts.
 */
function decorateAttachmentForClient(att: any) {
    const meta = (att?.structuredMetadata && typeof att.structuredMetadata === 'object')
    ? (att.structuredMetadata as Record<string, any>)
    : {};
  return {
    ...att,
    extractionQuality: meta.extractionQuality,
    extractionStats: meta.extractionStats,
  };
}

/**
 * Normalizes heterogeneous message blocks into an envelope shape for clients.
 *
 * @param rawBlocks - Message blocks as stored in persistence layer.
 * @returns A `{ blocks: [...] }` envelope compatible with frontend rendering.
 */
function normalizeBlocksForClient(rawBlocks: unknown) {
  if (isChatBlocksEnvelope(rawBlocks)) return rawBlocks;
  if (Array.isArray(rawBlocks)) return { blocks: rawBlocks };
  if (rawBlocks && typeof rawBlocks === "object") {
        const maybe = rawBlocks as { blocks?: unknown };
    if (Array.isArray(maybe.blocks)) return { blocks: maybe.blocks };
  }
  return { blocks: [] };
}

/**
 * Converts an incoming Express multipart request into Web `FormData`.
 *
 * @param req - Express request with multipart payload.
 * @returns Parsed form data.
 */
async function requestToFormData(req: any): Promise<any> {
    const base = `http://${req.headers.host || 'localhost'}`;
    const url = `${base}${req.originalUrl || req.url || ''}`;
    const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req,
    // @ts-expect-error Node fetch requires duplex for streamed bodies
    duplex: 'half',
  });
  return request.formData();
}

router.post('/client-telemetry', async (req, res) => {
    const userId = req.auth?.user?.id || 'unknown';
    const level = String(req.body?.level || 'info').toLowerCase();
    const category = String(req.body?.category || 'client_event');
    const message = String(req.body?.message || 'client_event');
    const metadata = (req.body?.metadata && typeof req.body.metadata === 'object') ? req.body.metadata : {};

  incrementCounter('autopilot_frontend_telemetry_events_total', { category, level });
  if (level === 'error') {
    logger.error({ scope: 'frontend.telemetry', message, userId, traceId: req.traceId, category, ...metadata });
  } else if (level === 'warn') {
    logger.warn({ scope: 'frontend.telemetry', message, userId, traceId: req.traceId, category, ...metadata });
  } else {
    logger.info({ scope: 'frontend.telemetry', message, userId, traceId: req.traceId, category, ...metadata });
  }

  return res.json({ status: 'ok' });
});

// List threads
router.get('/threads', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const limit = req.query.limit ? Math.max(1, Math.min(200, Number(req.query.limit))) : 50;
        const before = typeof req.query.before === 'string' ? req.query.before : undefined;
        const threads = await ChatRepo.getThreads(userId, { limit, before });
        const nextCursor = threads.length >= limit ? threads[threads.length - 1]?.updatedAt : null;
    res.json({ status: 'ok', data: threads, meta: { limit, nextCursor } });
  } catch (err) { next(err); }
});

// Get messages for a thread
router.get('/threads/:threadId/messages', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const thread = await ChatRepo.getThreadById(req.params.threadId);
    if (!thread || thread.userId !== userId) {
      return res.status(404).json({ error: 'Thread not found' });
    }
        const limit = req.query.limit ? Math.max(1, Math.min(500, Number(req.query.limit))) : 200;
        const before = typeof req.query.before === 'string' ? req.query.before : undefined;
        const msgs = await ChatRepo.getMessages(req.params.threadId, { limit, before });
        const attachments = await ChatRepo.getAttachmentsByMessageIds(msgs.map((m) => m.id));
        const grouped = attachments.reduce<Record<string, any[]>>((acc, att) => {
            const key = att.messageId || '';
      if (!key) return acc;
      (acc[key] ||= []).push(att);
      return acc;
    }, {});
        const runtime = getRuntimeConfig();
        const enriched = msgs.map((msg) => {
            const normalizedBlocks = runtime.features.typedContracts
        ? normalizeBlocksForClient(msg.blocks as unknown)
        : (msg.blocks as unknown);
      if (runtime.features.typedContracts && !isChatBlocksEnvelope(normalizedBlocks)) {
        logger.warn({
          scope: "chat.routes",
          message: "Message blocks failed typed contract normalization",
          threadId: req.params.threadId,
          messageId: msg.id,
        });
      }
      return {
        ...msg,
        blocks: normalizedBlocks,
        attachments: (grouped[msg.id] || []).map(decorateAttachmentForClient),
      };
    });
        const nextCursor = msgs.length >= limit ? msgs[0]?.createdAt : null;
    res.json({ status: 'ok', data: enriched, meta: { limit, nextCursor } });
  } catch (err) { next(err); }
});

router.get('/threads/:threadId/react-telemetry', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const thread = await ChatRepo.getThreadById(req.params.threadId);
    if (!thread || thread.userId !== userId) {
      return res.status(404).json({ error: 'Thread not found' });
    }
        const limit = req.query.limit ? Math.max(20, Math.min(500, Number(req.query.limit))) : 200;
        const analytics = await ReActTelemetryAnalyticsService.summarizeThread(req.params.threadId, { limit });
    res.json({ status: 'ok', data: analytics, meta: { limit } });
  } catch (err) { next(err); }
});

router.get('/threads/:threadId/audit-log', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const thread = await ChatRepo.getThreadById(req.params.threadId);
    if (!thread || thread.userId !== userId) {
      return res.status(404).json({ error: 'Thread not found' });
    }
        const limit = req.query.limit ? Math.max(1, Math.min(200, Number(req.query.limit))) : 100;
        const items = await ContextService.getAuditEvents(req.params.threadId, limit);
    res.json({
      status: 'ok',
            data: items.map((item) => ({
        id: item.id,
        summary: item.summary,
        content: item.content,
        metadata: item.metadata,
        workflowRunId: item.workflowRunId,
        workflowId: item.workflowId,
        createdAt: item.createdAt,
      })),
      meta: { limit },
    });
  } catch (err) { next(err); }
});

router.post('/attachments', rateLimit({ keyPrefix: 'chat-attachments', limit: 30, windowMs: 60_000 }), async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const form = await requestToFormData(req);
        const threadIdRaw = form.get('threadId');
        const threadId = typeof threadIdRaw === 'string' && threadIdRaw.trim() ? threadIdRaw.trim() : null;
        const providerIdRaw = form.get('providerId');
        const providerId = typeof providerIdRaw === 'string' && providerIdRaw.trim() ? providerIdRaw.trim() : undefined;
        const modelRaw = form.get('model');
        const model = typeof modelRaw === 'string' && modelRaw.trim() ? modelRaw.trim() : undefined;
    if (!threadId) {
      return res.status(400).json({ error: 'threadId is required' });
    }
        const thread = await ChatRepo.getThreadById(threadId);
    if (!thread || thread.userId !== userId) {
      return res.status(404).json({ error: 'Thread not found' });
    }

        const files = form.getAll('files');
    if (!files.length) {
      return res.status(400).json({ error: 'No files provided' });
    }
    if (files.length > MAX_FILES_PER_MESSAGE) {
      return res.status(400).json({ error: `Maximum ${MAX_FILES_PER_MESSAGE} files are allowed per message` });
    }

        const created: any[] = [];
    for (const entry of files as any[]) {
      if (!entry || typeof entry.arrayBuffer !== 'function') continue;
            const detectedMimeType = typeof entry.type === 'string' && entry.type ? entry.type : 'application/octet-stream';
            const filename = typeof entry.name === 'string' && entry.name ? entry.name : `upload-${Date.now()}`;
            const mimeType = AttachmentProcessingService.inferMimeFromFilename(filename) || detectedMimeType;
            const fileSize = Number(entry.size || 0);
      if (!AttachmentProcessingService.isMimeAllowed(mimeType, filename)) {
        return res.status(400).json({ error: `Unsupported file type: ${mimeType || 'unknown'} (${filename})` });
      }
      if (fileSize > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ error: `File ${filename} exceeds max upload size` });
      }

            let storedPath: string | null = null;
      try {
                const bytes = new Uint8Array(await entry.arrayBuffer());
                const stored = await AttachmentStorageService.saveFile({
          userId,
          threadId,
          filename,
          bytes,
        });
        storedPath = stored.relativePath;
                const processed = await AttachmentProcessingService.processAttachment(
          {
            filename,
            mimeType,
            bytes,
          },
          { providerId, model },
        );
                const row = await ChatRepo.createAttachment({
          userId,
          threadId,
          filename,
          mimeType,
          sizeBytes: fileSize,
          storagePath: stored.relativePath,
          checksum: stored.checksum,
          processingStatus: processed.processingStatus,
          extractedText: processed.extractedText || null,
          structuredMetadata: processed.structuredMetadata || null,
          previewData: processed.previewData || null,
          error: processed.error || null,
        });
        if (processed.chunks?.length) {
          await ChatRepo.replaceAttachmentChunks({
            attachmentId: row.id,
            userId,
            chunks: processed.chunks,
          });
        }
        created.push(decorateAttachmentForClient(row));
      } catch (fileErr: any) {
        if (storedPath) {
          await AttachmentStorageService.removeFile(storedPath);
        }
                const rawMessage = String(fileErr?.message || 'Attachment processing failed');
                const message = rawMessage.includes('Failed query:')
          ? 'Attachment schema is out of sync. Please run database migration (or restart to auto-heal schema).'
          : rawMessage;
        return res.status(500).json({ error: `Failed to process ${filename}`, message });
      }
    }

    res.status(201).json({ status: 'ok', data: created });
  } catch (err) { next(err); }
});

router.get('/attachments/:attachmentId', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const attachment = await ChatRepo.getAttachmentById(req.params.attachmentId);
    if (!attachment || attachment.userId !== userId) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    res.json({ status: 'ok', data: decorateAttachmentForClient(attachment) });
  } catch (err) { next(err); }
});

router.delete('/attachments/:attachmentId', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const attachment = await ChatRepo.deleteAttachmentById(userId, req.params.attachmentId);
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    await AttachmentStorageService.removeFile(attachment.storagePath);
    res.json({ status: 'ok', data: attachment });
  } catch (err) { next(err); }
});

// Create a new chat thread
router.post('/threads', validate(createThreadSchema), async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
    const { title } = req.body;
        const thread = await ChatService.createThread(userId, title);
    res.status(201).json({ status: 'ok', data: thread });
  } catch (err) { next(err); }
});

// Rename a thread
router.patch('/threads/:threadId', validate(renameThreadSchema), async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const thread = await ChatRepo.getThreadById(req.params.threadId as string);
    if (!thread || thread.userId !== userId) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    const { title } = req.body;
        const updated = await ChatService.renameThread(req.params.threadId as string, title);
    res.json({ status: 'ok', data: updated });
  } catch (err) { next(err); }
});

// Delete a thread (and its messages)
router.delete('/threads/:threadId', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const thread = await ChatRepo.getThreadById(req.params.threadId);
    if (!thread || thread.userId !== userId) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    await ChatService.deleteThread(req.params.threadId);
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

// Delete ALL threads for the current user
router.delete('/threads', async (req, res, next) => {
  try {
        const count = await ChatService.deleteAllThreads(req.auth!.user.id);
    res.json({ status: 'ok', data: { deleted: count } });
  } catch (err) { next(err); }
});

// Post a message and trigger orchestration (non-streaming, legacy)
router.post('/threads/:threadId/messages', validate(addMessageSchema), async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const threadId = req.params.threadId as string;
    const { role, content, providerId, model, attachmentIds } = req.body;
        const thread = await ChatRepo.ensureThread(threadId, userId, "New Thread");
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
        const attachments = await ChatRepo.getAttachmentsByIds(userId, attachmentIds || []);
    if ((attachmentIds || []).length !== attachments.length) {
      return res.status(400).json({ error: 'One or more attachments are invalid or not accessible' });
    }
        const userMessage = await ChatService.addMessage(threadId, role, content);
    await ChatRepo.linkAttachmentsToMessage({ userId, threadId, messageId: userMessage.id, attachmentIds: attachments.map((a) => a.id) });
        const assistantReply = await dispatchAssistantMessage({
      threadId,
      content,
      traceId: req.traceId,
      userId,
      providerId,
      model,
      attachments,
      temporalInput: {
        profileTimezone: req.auth?.user?.timezone || null,
        headerTimezone: headerValue(req.headers['x-user-timezone']),
      },
    });
    res.status(201).json({ status: 'ok', data: { userMessage, assistantReply } });
  } catch (err) { next(err); }
});

// SSE streaming: post a message and receive assistant response as an event stream
router.post('/threads/:threadId/messages/stream', validate(addMessageSchema), async (req, res) => {
    const userId = req.auth!.user.id;
    const threadId = req.params.threadId as string;
  const { role, content, providerId, model, attachmentIds } = req.body;

  // Establish SSE connection
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

    const send = (event: string, data: object) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Keepalive heartbeat — prevents proxies from closing an idle connection
    const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(':heartbeat\n\n');
  }, 15_000);

  try {
        const thread = await ChatRepo.ensureThread(threadId, userId, "New Thread");
    if (!thread) {
      send('error', { message: 'Thread not found' });
      clearInterval(heartbeat);
      return res.end();
    }

    // 1. Persist user message
        const attachments = await ChatRepo.getAttachmentsByIds(userId, attachmentIds || []);
    if ((attachmentIds || []).length !== attachments.length) {
      send('error', { message: 'One or more attachments are invalid or not accessible' });
      clearInterval(heartbeat);
      return res.end();
    }
        const userMessage = await ChatService.addMessage(threadId, role, content);
    await ChatRepo.linkAttachmentsToMessage({ userId, threadId, messageId: userMessage.id, attachmentIds: attachments.map((a) => a.id) });
    send('attachments_linked', { attachments: attachments.map(decorateAttachmentForClient) });
    send('user_saved', { message: userMessage });

    // 2. Signal thinking state to client
    send('thinking', { label: 'Analyzing your request\u2026' });

    // 3. Orchestrate with progressive block/chunk callbacks
        const streamCallbacks = {
            onBlock: (index: number, block: any) => send('block', { index, block }),
            onChunk: (blockIndex: number, content: string) => send('chunk', { blockIndex, content }),
            onBlockEnd: (blockIndex: number) => send('block_end', { blockIndex }),
    };

        const temporalInput = {
      profileTimezone: req.auth?.user?.timezone || null,
      headerTimezone: headerValue(req.headers['x-user-timezone']),
    };

        let assistantMessage;
    if (AgentService.isEnabled()) {
      try {
        assistantMessage = await AgentService.handleStreamingMessage(
          threadId,
          content,
          req.traceId,
          userId,
          providerId,
          model,
          attachments,
          streamCallbacks,
          temporalInput,
        );
      } catch (err) {
        logger.warn({
          scope: 'chat.routes',
          message: 'AgentService streaming failed, falling back to orchestrator',
          threadId,
          traceId: req.traceId,
          userId,
          err,
        });
      }
    }

    if (!assistantMessage) {
      assistantMessage = await OrchestratorService.handleStreamingMessage(
        threadId,
        content,
        req.traceId,
        userId,
        providerId,
        model,
        attachments,
        streamCallbacks,
        temporalInput,
      );
    }

    // 4. Signal completion with persisted message metadata
    send('complete', { messageId: assistantMessage.id, createdAt: assistantMessage.createdAt });

  } catch (err: any) {
    send('error', { message: err?.message ?? 'Internal server error' });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

router.post('/threads/:threadId/messages/:messageId/questions/:questionId/answer', validate(answerQuestionSchema), async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const threadId = req.params.threadId as string;
        const messageId = req.params.messageId as string;
        const questionId = req.params.questionId as string;
    const { optionId, valueToSend, providerId, model } = req.body as {
      optionId?: string;
            valueToSend: string;
      providerId?: string;
      model?: string;
    };

        const thread = await ChatRepo.getThreadById(threadId);
    if (!thread || thread.userId !== userId) {
      return res.status(404).json({ error: 'Thread not found' });
    }

        const message = await ChatRepo.getMessageById(threadId, messageId);
    if (!message || message.role !== 'assistant') {
      return res.status(404).json({ error: 'Assistant message not found' });
    }

        const rawBlocks = (message.blocks as any)?.blocks || message.blocks || [];
        const blocks = Array.isArray(rawBlocks) ? rawBlocks : [];
        const qIndex = blocks.findIndex((b: any) => b?.type === 'question_mcq' && b?.questionId === questionId);
    if (qIndex < 0) {
      return res.status(404).json({ error: 'Question not found in message' });
    }

        const targetQuestion = blocks[qIndex] as any;
        const alreadyAnswered = targetQuestion?.state === 'answered';
    if (alreadyAnswered) {
      return res.json({ status: 'ok', data: { message } });
    }

        const selected =
      (Array.isArray(targetQuestion?.options) ? targetQuestion.options : []).find((opt: any) => (
        (optionId && opt?.id === optionId) || opt?.valueToSend === valueToSend
      )) || null;

        const followupMsg = await dispatchAssistantMessage({
      threadId,
      content: String(valueToSend || ''),
      traceId: req.traceId,
      userId,
      providerId,
      model,
      attachments: [],
      temporalInput: {
        profileTimezone: req.auth?.user?.timezone || null,
        headerTimezone: headerValue(req.headers['x-user-timezone']),
      },
    });

        const followupRawBlocks = (followupMsg as any)?.blocks?.blocks || (followupMsg as any)?.blocks || [];
        const followupBlocks = Array.isArray(followupRawBlocks) ? followupRawBlocks : [];
        const continuationBlocks = followupBlocks.filter((b: any) => (
      b?.type !== 'summary' &&
      !(b?.type === 'detail_toggle' && (
        String((b?.meta || {})?.planKind || '').toLowerCase() === 'main_agent' ||
        String(b?.summary || '').toLowerCase().includes('main agent execution plan')
      ))
    ));

        const nowIso = new Date().toISOString();
        const nextBlocks = blocks.map((block: any, idx: number) => {
      if (idx !== qIndex) return block;
      return {
        ...block,
        state: 'answered',
        selectedOptionId: selected?.id || optionId || null,
        selectedValue: String(valueToSend || ''),
        answeredAt: nowIso,
        collapsed: true,
        continuation: continuationBlocks,
      };
    });

        const nextContent =
      continuationBlocks.find((b: any) => b?.type === 'markdown' && typeof b?.text === 'string')?.text
      || followupMsg.content
      || message.content
      || '';

        const updated = await ChatRepo.updateMessageBlocks(threadId, messageId, { blocks: nextBlocks }, nextContent.slice(0, 2000));
    await ChatRepo.deleteMessageById(threadId, followupMsg.id);

    res.json({ status: 'ok', data: { message: updated } });
  } catch (err) {
    next(err);
  }
});

/**
 * Chat API router for thread, message, attachment, and streaming endpoints.
 *
 * @remarks
 * Mounted at `/api/chat` behind `requireAuth` in backend bootstrap.
 */
export { router as chatRouter };
