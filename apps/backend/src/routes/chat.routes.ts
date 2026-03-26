import { Router } from 'express';
import { validate } from '../middleware/validate.middleware';
import { createThreadSchema, addMessageSchema, renameThreadSchema } from '../schemas/chat.schema';
import { ChatService } from '../services/chat.service';
import { OrchestratorService } from '../services/orchestrator.service';
import { ChatRepo } from '../repositories/chat.repo';

const router = Router();
const USER_ID = "usr_admin";

// List threads
router.get('/threads', async (req, res, next) => {
  try {
    const threads = await ChatRepo.getThreads(USER_ID);
    res.json({ status: 'ok', data: threads });
  } catch (err) { next(err); }
});

// Get messages for a thread
router.get('/threads/:threadId/messages', async (req, res, next) => {
  try {
    const msgs = await ChatRepo.getMessages(req.params.threadId);
    res.json({ status: 'ok', data: msgs });
  } catch (err) { next(err); }
});

// Create a new chat thread
router.post('/threads', validate(createThreadSchema), async (req, res, next) => {
  try {
    const { title } = req.body;
    const thread = await ChatService.createThread(USER_ID, title);
    res.status(201).json({ status: 'ok', data: thread });
  } catch (err) { next(err); }
});

// Rename a thread
router.patch('/threads/:threadId', validate(renameThreadSchema), async (req, res, next) => {
  try {
    const { title } = req.body;
    const thread = await ChatService.renameThread(req.params.threadId as string, title);
    res.json({ status: 'ok', data: thread });
  } catch (err) { next(err); }
});

// Delete a thread (and its messages)
router.delete('/threads/:threadId', async (req, res, next) => {
  try {
    await ChatService.deleteThread(req.params.threadId);
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

// Delete ALL threads for the current user
router.delete('/threads', async (req, res, next) => {
  try {
    const count = await ChatService.deleteAllThreads(USER_ID);
    res.json({ status: 'ok', data: { deleted: count } });
  } catch (err) { next(err); }
});

// Post a message and trigger orchestration (non-streaming, legacy)
router.post('/threads/:threadId/messages', validate(addMessageSchema), async (req, res, next) => {
  try {
    const threadId = req.params.threadId as string;
    const { role, content, providerId, model } = req.body;
    const userMessage = await ChatService.addMessage(threadId, role, content);
    const assistantReply = await OrchestratorService.handleIncomingMessage(threadId, content, req.traceId, providerId, model);
    res.status(201).json({ status: 'ok', data: { userMessage, assistantReply } });
  } catch (err) { next(err); }
});

// SSE streaming: post a message and receive assistant response as an event stream
router.post('/threads/:threadId/messages/stream', validate(addMessageSchema), async (req, res) => {
  const threadId = req.params.threadId as string;
  const { role, content, providerId, model } = req.body;

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
    // 1. Persist user message
    const userMessage = await ChatService.addMessage(threadId, role, content);
    send('user_saved', { message: userMessage });

    // 2. Signal thinking state to client
    send('thinking', { label: 'Analyzing your request\u2026' });

    // 3. Orchestrate with progressive block/chunk callbacks
    const assistantMessage = await OrchestratorService.handleStreamingMessage(
      threadId, content, req.traceId, providerId, model,
      {
        onBlock:    (index, block)   => send('block',     { index, block }),
        onChunk:    (blockIndex, content) => send('chunk', { blockIndex, content }),
        onBlockEnd: (blockIndex)    => send('block_end', { blockIndex }),
      },
    );

    // 4. Signal completion with persisted message metadata
    send('complete', { messageId: assistantMessage.id, createdAt: assistantMessage.createdAt });

  } catch (err: any) {
    send('error', { message: err?.message ?? 'Internal server error' });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

export { router as chatRouter };
