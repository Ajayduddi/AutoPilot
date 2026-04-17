/**
 * @fileoverview apps/backend/src/services/context/context-memory-extraction.service.ts
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
import { ContextService } from './context.service';
import {
  LLMService,
  type ExtractThreadMemoryResult,
  type ExtractedThreadMemoryCandidate,
} from '../ai-routing/llm.service';
import { logger } from '../../util/logger';

type ExtractMemoryTurnInput = {
  threadId: string;
  userId: string;
  userMessage: string;
  assistantReply?: string;
  sourceMessageIds?: string[];
  providerId?: string;
  model?: string;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function hasExplicitDurableSignal(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return /\b(prefer|preference|remember that|always use|call me|my name is|timezone is|project|client|account|renewal|invoice|contract|resume|need to|todo|follow up|remind me|pending)\b/.test(normalized);
}

function shouldEvaluateTurn(input: ExtractMemoryTurnInput): boolean {
  const userMessage = normalizeText(input.userMessage);
  const assistantReply = normalizeText(input.assistantReply);
  if (!userMessage || userMessage.length < 12) return false;
  if (hasExplicitDurableSignal(userMessage)) return true;
  if (assistantReply.length >= 120) return true;
  return userMessage.length >= 40;
}

function sanitizeContent(text: string): string {
  return normalizeText(text)
    .replace(/\b(bearer)\s+[a-z0-9._~+/=-]{12,}\b/gi, '$1 [REDACTED]')
    .replace(/\b(sk|gsk|rk|pk)_[a-z0-9_-]{10,}\b/gi, '[REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|auth|authorization|password|secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:api[_ -]?key|access[_ -]?token|authorization|password|secret|client[_ -]?secret)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z0-9+/_=-]{28,}\b/g, (value) => {
      if (/^[A-Za-z0-9_-]+$/.test(value) && value.length <= 40) return value;
      return '[REDACTED]';
    });
}

function normalizeCandidates(
  result: ExtractThreadMemoryResult | null,
  sourceMessageIds: string[],
): Array<ExtractedThreadMemoryCandidate & { sourceMessageIds: string[] }> {
  if (!result?.candidates?.length) return [];
  return result.candidates
    .map((candidate) => ({
      ...candidate,
      summary: sanitizeContent(candidate.summary),
      content: sanitizeContent(candidate.content),
      entityKeys: [...new Set((candidate.entityKeys || []).map((value) => normalizeText(value)).filter(Boolean))].slice(0, 10),
      sourceMessageIds,
    }))
    .filter((candidate) =>
      candidate.summary.length >= 8
      && candidate.content.length >= 20
      && candidate.shouldStore,
    );
}

export class ContextMemoryExtractionService {
  static async extractAndIndexFromTurn(input: ExtractMemoryTurnInput): Promise<void> {
    if (!shouldEvaluateTurn(input)) return;

    const sourceMessageIds = [...new Set((input.sourceMessageIds || []).map((value) => normalizeText(value)).filter(Boolean))];

    try {
      const extracted = await LLMService.extractThreadMemoryCandidates({
        userMessage: input.userMessage,
        assistantReply: input.assistantReply,
        providerId: input.providerId,
        model: input.model,
      });

      const normalizedCandidates = normalizeCandidates(extracted, sourceMessageIds);
      if (normalizedCandidates.length > 0) {
        for (const candidate of normalizedCandidates) {
          await ContextService.indexChatSummary({
            threadId: input.threadId,
            userId: input.userId,
            content: candidate.content,
            summary: candidate.summary,
            summaryKind: candidate.summaryKind,
            importance: candidate.importance,
            entityKeys: candidate.entityKeys,
            sourceMessageIds: candidate.sourceMessageIds,
          });
        }

        logger.info({
          scope: 'context-memory-extraction.service',
          message: 'Stored LLM-derived thread memory summaries',
          threadId: input.threadId,
          userId: input.userId,
          candidateCount: normalizedCandidates.length,
          kinds: [...new Set(normalizedCandidates.map((candidate) => candidate.summaryKind))],
          provider: extracted?.provider || '',
          model: extracted?.model || '',
        });
        return;
      }
    } catch (err) {
      logger.warn({
        scope: 'context-memory-extraction.service',
        message: 'LLM thread memory extraction failed; using heuristic fallback',
        threadId: input.threadId,
        userId: input.userId,
        err,
      });
    }

    await ContextService.maybeIndexChatSummaryFromTurn({
      threadId: input.threadId,
      userId: input.userId,
      userMessage: input.userMessage,
      assistantReply: input.assistantReply,
      sourceMessageIds,
    });
  }
}
