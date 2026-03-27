import { and, eq, inArray, lt } from 'drizzle-orm';
import { db } from '../db';
import { chatThreads, chatMessages, workflowRuns } from '../db/schema';
import { generateThreadId } from '../util/thread-id';
import { randomUUID } from 'crypto';

export const ChatRepo = {
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
      await db.delete(chatMessages).where(inArray(chatMessages.threadId, threadIds));
    }
    await db.delete(chatThreads).where(eq(chatThreads.userId, userId));
    return threads.length;
  },
};
