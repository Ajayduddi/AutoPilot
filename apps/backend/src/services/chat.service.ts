/**
 * @fileoverview services/chat.service.
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { ChatRepo } from '../repositories/chat.repo';
import { ContextService } from './context/context.service';

/**
 * ChatService class.
 *
 * Encapsulates chat service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
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
        const threads = await ChatRepo.getThreads(userId, { limit: 10_000 });
    for (const t of threads) {
      await ContextService.deleteThreadContext(t.id);
    }
    return ChatRepo.deleteAllThreads(userId);
  }
}
