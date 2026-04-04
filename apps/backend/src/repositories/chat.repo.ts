/**
 * @fileoverview repositories/chat.repo.
 *
 * Database access utilities and persistence workflows for backend entities.
 */
import { and, eq, inArray, isNull, lt, asc } from 'drizzle-orm';
import { db } from '../db';
import { chatThreads, chatMessages, workflowRuns, chatAttachments, chatAttachmentChunks } from '../db/schema';
import { generateThreadId } from '../util/thread-id';
import { randomUUID } from 'crypto';

/**
 * ChatRepo exported constant.
 */
export const ChatRepo = {
  async assertAttachmentSchemaReady() {
    await db.query.chatAttachments.findFirst({
      columns: { id: true },
    });
    await db.query.chatAttachmentChunks.findFirst({
      columns: { id: true },
    });
  },

    async ensureThread(threadId: string, userId: string, title = "New Thread") {
        const existing = await db.query.chatThreads.findFirst({
      where: eq(chatThreads.id, threadId),
    });
    if (existing) {
      if (existing.userId !== userId) return null;
      return existing;
    }

    await db.insert(chatThreads).values({
      id: threadId,
      userId,
      title,
    }).onConflictDoNothing();

        const created = await db.query.chatThreads.findFirst({
      where: eq(chatThreads.id, threadId),
    });
    return created;
  },

    async createThread(userId: string, title: string) {
        const id = generateThreadId();
    const [thread] = await db.insert(chatThreads).values({
      id,
      userId,
      title,
    }).returning();
    return thread;
  },

    async getThreadById(threadId: string) {
    return db.query.chatThreads.findFirst({
      where: eq(chatThreads.id, threadId),
    });
  },

  async getThreads(userId: string, opts?: { limit?: number; before?: string }) {
        const limit = Math.max(1, Math.min(200, opts?.limit || 50));
        const where = opts?.before
      ? and(eq(chatThreads.userId, userId), lt(chatThreads.updatedAt, new Date(opts.before)))
      : eq(chatThreads.userId, userId);
    return await db.query.chatThreads.findMany({
      where,
            orderBy: (threads, { desc }) => [desc(threads.updatedAt)],
      limit,
    });
  },

    async addMessage(threadId: string, role: 'user' | 'assistant' | 'system', content?: string, blocks?: any) {
        const id = `msg_${randomUUID()}`;
    const [msg] = await db.insert(chatMessages).values({
      id,
      threadId,
      role,
      content,
      blocks,
    }).returning();
    
    // Update thread updated_at
    await db.update(chatThreads)
      .set({ updatedAt: new Date() })
      .where(eq(chatThreads.id, threadId));
      
    return msg;
  },

    async getMessageById(threadId: string, messageId: string) {
    return db.query.chatMessages.findFirst({
      where: and(eq(chatMessages.id, messageId), eq(chatMessages.threadId, threadId)),
    });
  },

    async updateMessageBlocks(threadId: string, messageId: string, blocks: any, content?: string) {
    const [row] = await db
      .update(chatMessages)
      .set({
        blocks,
        ...(typeof content === 'string' ? { content } : {}),
      })
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.threadId, threadId)))
      .returning();
    return row;
  },

    async deleteMessageById(threadId: string, messageId: string) {
    const [row] = await db
      .delete(chatMessages)
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.threadId, threadId)))
      .returning();
    return row;
  },

  async createAttachment(input: {
        userId: string;
    threadId?: string | null;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        storagePath: string;
        checksum: string;
    processingStatus?: 'uploaded' | 'processing' | 'processed' | 'failed' | 'not_parsable';
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
    error?: string | null;
  }) {
        const id = `att_${randomUUID()}`;
    const [row] = await db.insert(chatAttachments).values({
      id,
      userId: input.userId,
      threadId: input.threadId ?? null,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storagePath: input.storagePath,
      checksum: input.checksum,
      processingStatus: input.processingStatus || 'uploaded',
      extractedText: input.extractedText ?? null,
      structuredMetadata: input.structuredMetadata ?? null,
      previewData: input.previewData ?? null,
      error: input.error ?? null,
      updatedAt: new Date(),
    }).returning();
    return row;
  },

  async updateAttachment(attachmentId: string, input: Partial<{
        messageId: string | null;
        threadId: string | null;
        processingStatus: 'uploaded' | 'processing' | 'processed' | 'failed' | 'not_parsable';
        extractedText: string | null;
        structuredMetadata: Record<string, unknown> | null;
        previewData: Record<string, unknown> | null;
        error: string | null;
  }>) {
    const [row] = await db.update(chatAttachments)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(chatAttachments.id, attachmentId))
      .returning();
    return row;
  },

    async getAttachmentById(attachmentId: string) {
    return db.query.chatAttachments.findFirst({
      where: eq(chatAttachments.id, attachmentId),
    });
  },

    async getAttachmentsByIds(userId: string, attachmentIds: string[]) {
    if (!attachmentIds.length) return [];
    return db.query.chatAttachments.findMany({
      where: and(eq(chatAttachments.userId, userId), inArray(chatAttachments.id, attachmentIds)),
            orderBy: (a, { asc }) => [asc(a.createdAt)],
    });
  },

    async listAttachmentsByThread(threadId: string) {
    return await db.query.chatAttachments.findMany({
      where: eq(chatAttachments.threadId, threadId),
            orderBy: (a, { asc }) => [asc(a.createdAt)],
    });
  },

  async linkAttachmentsToMessage(input: { userId: string; threadId: string; messageId: string; attachmentIds: string[] }) {
    if (!input.attachmentIds.length) return;
    await db.update(chatAttachments)
      .set({ messageId: input.messageId, threadId: input.threadId, updatedAt: new Date() })
      .where(and(
        eq(chatAttachments.userId, input.userId),
        inArray(chatAttachments.id, input.attachmentIds),
        isNull(chatAttachments.messageId),
      ));
  },

    async getAttachmentsByMessageIds(messageIds: string[]) {
    if (!messageIds.length) return [];
    return await db.query.chatAttachments.findMany({
      where: inArray(chatAttachments.messageId, messageIds),
            orderBy: (a, { asc }) => [asc(a.createdAt)],
    });
  },

  async replaceAttachmentChunks(input: {
        attachmentId: string;
        userId: string;
    chunks: Array<{
            content: string;
      tokenCount?: number | null;
      metadata?: Record<string, unknown> | null;
    }>;
  }) {
    await db.delete(chatAttachmentChunks).where(eq(chatAttachmentChunks.attachmentId, input.attachmentId));
    if (!input.chunks.length) return;
    await db.insert(chatAttachmentChunks).values(
      input.chunks.map((chunk, idx) => ({
        id: `atchk_${randomUUID()}`,
        attachmentId: input.attachmentId,
        userId: input.userId,
        chunkIndex: idx,
        content: chunk.content,
        tokenCount: chunk.tokenCount ?? null,
        metadata: chunk.metadata ?? null,
      })),
    );
  },

    async getAttachmentChunksByAttachmentIds(attachmentIds: string[], opts?: { limitPerAttachment?: number }) {
    if (!attachmentIds.length) return [];
        const rows = await db.query.chatAttachmentChunks.findMany({
      where: inArray(chatAttachmentChunks.attachmentId, attachmentIds),
      orderBy: [asc(chatAttachmentChunks.attachmentId), asc(chatAttachmentChunks.chunkIndex)],
    });
        const max = Math.max(1, opts?.limitPerAttachment || 8);
        const counts = new Map<string, number>();
    return rows.filter((r) => {
            const c = counts.get(r.attachmentId) || 0;
      if (c >= max) return false;
      counts.set(r.attachmentId, c + 1);
      return true;
    });
  },

    async deleteAttachmentById(userId: string, attachmentId: string) {
    await db.delete(chatAttachmentChunks).where(eq(chatAttachmentChunks.attachmentId, attachmentId));
    const [row] = await db.delete(chatAttachments)
      .where(and(eq(chatAttachments.id, attachmentId), eq(chatAttachments.userId, userId)))
      .returning();
    return row;
  },

  async getMessages(threadId: string, opts?: { limit?: number; before?: string }) {
        const limit = Math.max(1, Math.min(500, opts?.limit || 200));
        const where = opts?.before
      ? and(eq(chatMessages.threadId, threadId), lt(chatMessages.createdAt, new Date(opts.before)))
      : eq(chatMessages.threadId, threadId);
    return await db.query.chatMessages.findMany({
      where,
            orderBy: (msgs, { asc }) => [asc(msgs.createdAt)],
      limit,
    });
  },

    async renameThread(threadId: string, title: string) {
    const [thread] = await db.update(chatThreads)
      .set({ title, updatedAt: new Date() })
      .where(eq(chatThreads.id, threadId))
      .returning();
    return thread;
  },

  async deleteThread(threadId: string) {
    // Null out FK references in workflow_runs, then delete messages, then thread
    await db.update(workflowRuns).set({ threadId: null }).where(eq(workflowRuns.threadId, threadId));
            const attachments = await db.query.chatAttachments.findMany({ where: eq(chatAttachments.threadId, threadId), columns: { id: true } });
            const attachmentIds = attachments.map(a => a.id);
    if (attachmentIds.length > 0) {
      await db.delete(chatAttachmentChunks).where(inArray(chatAttachmentChunks.attachmentId, attachmentIds));
      await db.delete(chatAttachments).where(inArray(chatAttachments.id, attachmentIds));
    }
    await db.delete(chatMessages).where(eq(chatMessages.threadId, threadId));
    await db.delete(chatThreads).where(eq(chatThreads.id, threadId));
  },

  async deleteAllThreads(userId: string) {
        const threads = await db.query.chatThreads.findMany({
      where: eq(chatThreads.userId, userId),
      columns: { id: true },
    });
        const threadIds = threads.map(t => t.id);
    if (threadIds.length > 0) {
      await db.update(workflowRuns).set({ threadId: null }).where(inArray(workflowRuns.threadId, threadIds));
              const attachments = await db.query.chatAttachments.findMany({ where: inArray(chatAttachments.threadId, threadIds), columns: { id: true } });
              const attachmentIds = attachments.map(a => a.id);
      if (attachmentIds.length > 0) {
        await db.delete(chatAttachmentChunks).where(inArray(chatAttachmentChunks.attachmentId, attachmentIds));
        await db.delete(chatAttachments).where(inArray(chatAttachments.id, attachmentIds));
      }
      await db.delete(chatMessages).where(inArray(chatMessages.threadId, threadIds));
    }
    await db.delete(chatThreads).where(eq(chatThreads.userId, userId));
    return threads.length;
  },
};
