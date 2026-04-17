/**
 * @fileoverview apps/backend/src/services/context/prompt-context.service.ts
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
import { TemporalService, type TemporalResolutionInput } from '../temporal.service';
import type { RetrievedContext } from '../../providers/llm/provider.interface';
import { contextConfig, getContextMaxRetrievalForModel } from '../../config/context.config';
import type { ContextCategory } from '../../repositories/context.repo';
import { incrementCounter, observeHistogram } from '../../util/metrics';

/**
 * Input contract for hybrid prompt context composition.
 */
type BuildHybridPromptContextInput = {
  surface?: 'agent' | 'orchestrator' | 'unknown';
  threadId: string;
  userId?: string;
  query: string;
  model?: string;
  temporalInput?: TemporalResolutionInput;
  categories?: ContextCategory[];
  exactLimit?: number;
  semanticLimit?: number;
  includeSemanticWorkflowRuns?: boolean;
  maxDecisionItems?: number;
};

/**
 * Builds a deterministic temporal section for prompt grounding.
 *
 * @param input - Optional temporal resolution input, including timezone hints.
 * @returns Multiline deterministic clock context section.
 *
 * @example
 * ```ts
 * const section = buildRuntimeClockPromptSection({ timezone: 'UTC' });
 * ```
 */
export function buildRuntimeClockPromptSection(input?: TemporalResolutionInput): string {
  const context = TemporalService.buildRuntimeClockContext(input || {});
  return [
    '[Deterministic Temporal Context]',
    context.text,
    `timezone: ${context.timezoneUsed}`,
    `generatedAt: ${context.iso}`,
  ].join('\n');
}

/**
 * Prompt-context composition service used by orchestrator and agent surfaces.
 */
export class PromptContextService {
  /**
   * Builds hybrid prompt context by combining exact thread context, optional
   * semantic retrieval, and deterministic temporal context.
   *
   * @param input - Thread/query context and retrieval controls.
   * @returns Prompt text plus optional retrieved context payload.
   *
   * @example
   * ```ts
   * const built = await PromptContextService.buildHybridThreadPromptContext({
   *   surface: 'orchestrator',
   *   threadId,
   *   userId,
   *   query: userMessage,
   * });
   * ```
   */
  static async buildHybridThreadPromptContext(input: BuildHybridPromptContextInput): Promise<{
    contextText: string;
    retrievedContext?: RetrievedContext;
  }> {
    const startedAt = performance.now();
    const surface = input.surface || 'unknown';
    const retrievalLimit = input.exactLimit ?? getContextMaxRetrievalForModel(input.model);
    const threadContext = await ContextService.getHybridThreadContext(input.threadId, {
      userId: input.userId,
      query: input.query,
      categories: input.categories,
      exactLimit: retrievalLimit,
      semanticLimit: input.semanticLimit ?? Math.min(3, retrievalLimit),
      includeSemanticWorkflowRuns: input.includeSemanticWorkflowRuns ?? true,
    });
    const formattedContext = ContextService.formatForPrompt(threadContext, {
      maxTotalTokens: contextConfig.retrievedContextBudgetTokens,
      maxTokensPerItem: contextConfig.maxContextItemTokens,
      maxDecisionItems: input.maxDecisionItems ?? 6,
    });
    const contextText = [buildRuntimeClockPromptSection(input.temporalInput), formattedContext]
      .filter(Boolean)
      .join('\n\n');
    observeHistogram('autopilot_prompt_context_build_latency_ms', performance.now() - startedAt, {
      surface,
      hasRetrievedContext: Boolean(formattedContext),
      hasSemanticQuery: Boolean(String(input.query || '').trim()),
    });
    incrementCounter('autopilot_prompt_context_build_total', {
      surface,
      hasRetrievedContext: Boolean(formattedContext),
    });
    return {
      contextText,
      retrievedContext: contextText ? { formatted: contextText } : undefined,
    };
  }
}
