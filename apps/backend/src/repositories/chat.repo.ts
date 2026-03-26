import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { chatThreads, chatMessages, workflowRuns } from '../db/schema';
import { generateThreadId } from '../util/thread-id';

export const ChatRepo = {
  async createThread(userId: string, title: string) {
    const id = generateThreadId();
    const [thread] = await db.insert(chatThreads).values({
      id,
      userId,
      title,
    }).returning();
    return thread;
  },

  async getThreads(userId: string) {
    return await db.query.chatThreads.findMany({
      where: eq(chatThreads.userId, userId),
      orderBy: (threads, { desc }) => [desc(threads.updatedAt)],
    });
  },

  async addMessage(threadId: string, role: 'user' | 'assistant' | 'system', content?: string, blocks?: any) {
    const id = `msg_${Date.now()}`;
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

  async getMessages(threadId: string) {
    return await db.query.chatMessages.findMany({
      where: eq(chatMessages.threadId, threadId),
      orderBy: (msgs, { asc }) => [asc(msgs.createdAt)],
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
