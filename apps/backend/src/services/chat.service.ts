import { ChatRepo } from '../repositories/chat.repo';
import { ContextService } from './context.service';

export class ChatService {
  static async createThread(userId: string, title?: string) {
    return ChatRepo.createThread(userId, title || "New Thread");
  }

  static async addMessage(threadId: string, role: "user" | "assistant" | "system", content: string, metadata?: any) {
    return ChatRepo.addMessage(threadId, role, content, metadata);
  }

  static async getMessages(threadId: string) {
    return ChatRepo.getMessages(threadId);
  }

  static async renameThread(threadId: string, title: string) {
    return ChatRepo.renameThread(threadId, title);
  }

  static async deleteThread(threadId: string) {
    // Clean up context memory for this thread before deletion
    await ContextService.deleteThreadContext(threadId);
    return ChatRepo.deleteThread(threadId);
  }

  static async deleteAllThreads(userId: string) {
    const threads = await ChatRepo.getThreads(userId);
    for (const t of threads) {
      await ContextService.deleteThreadContext(t.id);
    }
    return ChatRepo.deleteAllThreads(userId);
  }
}
