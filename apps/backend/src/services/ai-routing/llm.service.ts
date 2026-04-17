/**
 * @fileoverview services/llm.service.
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
import { LLMFactory } from '../../providers/llm/llm.factory';
import { WorkflowService } from '../workflow/workflow.service';
import type {
  ParsedIntent,
  ConversationMessage,
  RetrievedContext,
  WorkflowContext,
  LlmGenerationOptions,
} from '../../providers/llm/provider.interface';
import { AutoModelRouterService, type AutoRouterCandidate } from './auto-router.service';
import { incrementCounter, observeHistogram } from '../../util/metrics';
import { logger } from '../../util/logger';
import { getRuntimeConfig } from '../../config/runtime.config';
/** Re-export of parsed user-intent contract used by API-layer callers. */
export type { ParsedIntent };

type LlmRoutingOptions = {
  routingHint?: "default" | "reasoning_heavy";
  generation?: LlmGenerationOptions;
};

type LlmCandidateAttempt = {
    candidate: AutoRouterCandidate;
    ok: boolean;
  latencyMs?: number;
  error?: string;
};

export type ThreadMemorySummaryKind = 'preference' | 'entity' | 'milestone' | 'unresolved_task' | 'recap';

export type ExtractedThreadMemoryCandidate = {
  summary: string;
  content: string;
  summaryKind: ThreadMemorySummaryKind;
  importance: 'low' | 'medium' | 'high';
  entityKeys: string[];
  shouldStore: boolean;
};

export type ExtractThreadMemoryResult = {
  candidates: ExtractedThreadMemoryCandidate[];
  provider: string;
  model: string;
};

/**
 * Renders model-attempt history as a compact chain for logs/telemetry.
 *
 * @param attempts - Candidate attempts in execution order.
 * @returns Human-readable attempt chain.
 */
function formatAttemptChain(attempts: LlmCandidateAttempt[]): string {
  return attempts
    .map((a) => `${a.candidate.providerLabel}:${a.candidate.model}${a.ok ? '' : '×'}`)
    .join(' -> ');
}

function formatAttemptErrors(attempts: LlmCandidateAttempt[]): string {
  return attempts
    .filter((a) => !a.ok && a.error)
    .map((a) => `${a.candidate.providerLabel}:${a.candidate.model} => ${a.error}`)
    .join(' | ');
}

function autoRouterMaxCandidates(): number {
  return getRuntimeConfig().autoRouter.maxCandidates;
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(String(raw || '')) as T;
  } catch {
    return null;
  }
}

function normalizeThreadMemoryCandidate(input: unknown): ExtractedThreadMemoryCandidate | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const summary = String(raw.summary || '').trim();
  const content = String(raw.content || '').trim();
  const summaryKind = String(raw.summaryKind || '').trim().toLowerCase();
  const importance = String(raw.importance || 'medium').trim().toLowerCase();
  const entityKeys = Array.isArray(raw.entityKeys)
    ? [...new Set(raw.entityKeys.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 12)
    : [];
  const shouldStore = typeof raw.shouldStore === 'boolean' ? raw.shouldStore : true;

  if (!summary || !content) return null;
  if (!['preference', 'entity', 'milestone', 'unresolved_task', 'recap'].includes(summaryKind)) return null;
  if (!['low', 'medium', 'high'].includes(importance)) return null;

  return {
    summary,
    content,
    summaryKind: summaryKind as ThreadMemorySummaryKind,
    importance: importance as 'low' | 'medium' | 'high',
    entityKeys,
    shouldStore,
  };
}

/** @returns Intent parsing timeout from runtime config. */
function parseIntentTimeoutMs(): number {
  return getRuntimeConfig().llm.parseIntentTimeoutMs;
}

/** @returns Non-streaming reply timeout from runtime config. */
function generateReplyTimeoutMs(): number {
  return getRuntimeConfig().llm.generateReplyTimeoutMs;
}

/** @returns Stall timeout for streaming token generation. */
function streamStallTimeoutMs(): number {
  return getRuntimeConfig().llm.streamStallTimeoutMs;
}

type WorkflowContextCacheEntry = {
    expiresAt: number;
    workflows: WorkflowContext[];
};

let workflowContextCache: WorkflowContextCacheEntry | null = null;

/**
 * Loads and caches workflow context used to ground LLM routing/intent parsing.
 *
 * @returns Workflow context list with short TTL caching.
 */
async function buildWorkflowContext(): Promise<WorkflowContext[]> {
    const now = Date.now();
  if (workflowContextCache && workflowContextCache.expiresAt > now) {
    return workflowContextCache.workflows;
  }

    const workflows = await WorkflowService.getAll();
    const normalized = workflows.map(wf => ({
    key: wf.key as string,
    name: (wf.name as string) || (wf.key as string),
    description: wf.description as string,
    provider: wf.provider as string,
    enabled: wf.enabled as boolean,
    visibility: wf.visibility as string,
    tags: (wf.tags as string[]) || [],
  }));
  workflowContextCache = {
    workflows: normalized,
    expiresAt: now + getRuntimeConfig().llm.workflowContextCacheTtlMs,
  };
  return normalized;
}

/**
 * Scores workflow relevance against user message and retrieved context.
 *
 * @param workflow - Candidate workflow context.
 * @param message - User message.
 * @param context - Optional retrieved context payload.
 * @returns Relevance score where higher is better.
 */
function scoreWorkflowRelevance(workflow: WorkflowContext, message: string, context?: RetrievedContext): number {
    const haystack = `${message}\n${context?.formatted || ''}`.toLowerCase();
    const key = String(workflow.key || '').toLowerCase();
    const name = String(workflow.name || '').toLowerCase();
    const description = String(workflow.description || '').toLowerCase();
    const tags = Array.isArray(workflow.tags) ? workflow.tags.map((tag) => String(tag).toLowerCase()) : [];

    let score = 0;
  if (key && haystack.includes(key)) score += 12;
  if (name && haystack.includes(name)) score += 10;
  for (const tag of tags) {
    if (tag && haystack.includes(tag)) score += 4;
  }
  for (const token of description.split(/\W+/).filter((t) => t.length >= 4).slice(0, 18)) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

/**
 * Selects the most relevant workflow context entries for LLM prompts.
 *
 * @param message - User message.
 * @param workflows - Full workflow context list.
 * @param context - Optional retrieved context.
 * @param limit - Maximum workflows to keep.
 * @returns Workflow shortlist sorted by relevance.
 */
function shortlistWorkflowContext(
  message: string,
  workflows: WorkflowContext[],
  context?: RetrievedContext,
  limit = 8,
): WorkflowContext[] {
  if (workflows.length <= limit) return workflows;

    const scored = workflows
    .map((workflow) => ({
      workflow,
      score: scoreWorkflowRelevance(workflow, message, context),
    }))
    .sort((a, b) => b.score - a.score);

    const relevant = scored.filter((entry) => entry.score > 0).slice(0, limit).map((entry) => entry.workflow);
  if (relevant.length >= Math.min(3, limit)) return relevant;

    const withRecentBias = [...relevant];
  for (const entry of scored) {
    if (withRecentBias.length >= limit) break;
    if (!withRecentBias.some((wf) => wf.key === entry.workflow.key)) {
      withRecentBias.push(entry.workflow);
    }
  }
  return withRecentBias.slice(0, limit);
}

/**
 * Orchestrates provider selection, failover, and timeout-safe LLM operations.
 */
export class LLMService {
  /**
   * Wraps an async operation with a timeout guard.
   *
   * @param promise - Operation promise.
   * @param timeoutMs - Timeout threshold in milliseconds.
   * @param label - Operation label included in timeout error message.
   * @returns Promise result when completed within timeout.
   * @throws {Error} When timeout is exceeded.
   */
  private static async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Performs provider-native attachment analysis (image/audio/document) with candidate failover.
   *
   * @param input - Attachment payload and optional extracted text hint.
   * @param providerId - Optional provider override.
   * @param model - Optional model override.
   * @returns Structured analysis payload, or `null` when unsupported/exhausted.
   */
  static async analyzeAttachmentWithProvider(
    input: {
            filename: string;
            mimeType: string;
            bytes: Uint8Array;
      extractedTextHint?: string | null;
    },
    providerId?: string,
    model?: string,
  ): Promise<{
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
  } | null> {
        const mime = (input.mimeType || '').toLowerCase();
        const decision = await AutoModelRouterService.resolveCandidates({
      providerId,
      model,
      maxCandidates: autoRouterMaxCandidates(),
    });

        const attempts: LlmCandidateAttempt[] = [];
    for (const candidate of decision.candidates) {
            const startedAt = Date.now();
      try {
                const provider = candidate.providerInstance;
                let result: {
          extractedText?: string | null;
          structuredMetadata?: Record<string, unknown> | null;
          previewData?: Record<string, unknown> | null;
        } | null = null;

        if (mime.startsWith('image/') && provider.analyzeImage) {
          result = await provider.analyzeImage({
            filename: input.filename,
            mimeType: input.mimeType,
            bytes: input.bytes,
          });
        } else if (mime.startsWith('audio/') && provider.transcribeAudio) {
          result = await provider.transcribeAudio({
            filename: input.filename,
            mimeType: input.mimeType,
            bytes: input.bytes,
          });
        } else if (provider.summarizeDocument) {
          result = await provider.summarizeDocument({
            filename: input.filename,
            mimeType: input.mimeType,
            bytes: input.bytes,
            extractedTextHint: input.extractedTextHint || null,
          });
        }

        // Candidate does not support this multimodal route; try next.
        if (!result) continue;

                const latencyMs = Date.now() - startedAt;
        AutoModelRouterService.reportSuccess(candidate, latencyMs);
        attempts.push({ candidate, ok: true, latencyMs });
        return result;
      } catch (err: any) {
        AutoModelRouterService.reportFailure(candidate);
        attempts.push({
          candidate,
          ok: false,
          error: String(err?.message || err || 'Unknown provider failure'),
        });
      }
    }

    if (attempts.some((a) => !a.ok)) {
      logger.warn({
        scope: 'llm.service',
        message: 'analyzeAttachmentWithProvider exhausted candidates',
        attempted: formatAttemptChain(attempts),
      });
    }

    return null;
  }

  static async extractThreadMemoryCandidates(input: {
    userMessage: string;
    assistantReply?: string;
    providerId?: string;
    model?: string;
    history?: ConversationMessage[];
    context?: RetrievedContext;
  }): Promise<ExtractThreadMemoryResult | null> {
    const userMessage = String(input.userMessage || '').trim();
    const assistantReply = String(input.assistantReply || '').trim();
    if (!userMessage || (!assistantReply && userMessage.length < 20)) return null;

    const prompt = [
      'You extract durable conversation memory for a chat-first automation assistant.',
      'Return strict JSON only.',
      'Store only durable facts worth remembering beyond the current turn.',
      'Allowed summaryKind values: preference, entity, milestone, unresolved_task, recap.',
      'If nothing durable should be stored, return {"candidates":[]}.',
      'Each candidate must contain: summary, content, summaryKind, importance, entityKeys, shouldStore.',
      'Do not include secrets, API keys, passwords, access tokens, or raw sensitive payloads.',
      '',
      `User message:\n${userMessage}`,
      assistantReply ? `\nAssistant reply:\n${assistantReply}` : '',
    ].filter(Boolean).join('\n');

    const decision = await AutoModelRouterService.resolveCandidates({
      providerId: input.providerId,
      model: input.model,
      maxCandidates: autoRouterMaxCandidates(),
      routingHint: 'default',
    });
    const attempts: LlmCandidateAttempt[] = [];

    for (const candidate of decision.candidates) {
      const startedAt = Date.now();
      try {
        const raw = await this.withTimeout(
          candidate.providerInstance.generateReply(
            prompt,
            [],
            input.history,
            input.context,
          ),
          generateReplyTimeoutMs(),
          `extractThreadMemory(${candidate.candidateKey})`,
        );
        const parsed = safeJsonParse<{ candidates?: unknown[] }>(String(raw || '').trim());
        const candidates = Array.isArray(parsed?.candidates)
          ? parsed!.candidates.map((item) => normalizeThreadMemoryCandidate(item)).filter(Boolean) as ExtractedThreadMemoryCandidate[]
          : [];
        const latencyMs = Date.now() - startedAt;
        AutoModelRouterService.reportSuccess(candidate, latencyMs);
        attempts.push({ candidate, ok: true, latencyMs });
        return {
          candidates,
          provider: candidate.provider,
          model: candidate.model,
        };
      } catch (err: any) {
        AutoModelRouterService.reportFailure(candidate);
        attempts.push({
          candidate,
          ok: false,
          error: String(err?.message || err || 'Unknown provider failure'),
        });
      }
    }

    logger.warn({
      scope: 'llm.service',
      message: 'extractThreadMemoryCandidates exhausted candidates',
      attempted: formatAttemptChain(attempts),
      errors: formatAttemptErrors(attempts),
    });
    return null;
  }

  /**
   * Parses user intent using routed LLM candidates with deterministic fallback.
   *
   * @param message - User message content.
   * @param providerId - Optional provider override.
   * @param model - Optional model override.
   * @param history - Optional conversation history.
   * @param context - Optional retrieved context.
   * @param options - Routing/generation options.
   * @returns Parsed intent contract used by orchestrators.
   */
  static async parseIntent(
    message: string,
    providerId?: string,
    model?: string,
    history?: ConversationMessage[],
    context?: RetrievedContext,
    options?: LlmRoutingOptions,
  ): Promise<ParsedIntent> {
        const workflowContext = shortlistWorkflowContext(
      message,
      await buildWorkflowContext(),
      context,
      getRuntimeConfig().llm.intentWorkflowShortlist,
    );
        const decision = await AutoModelRouterService.resolveCandidates({
      providerId,
      model,
      maxCandidates: autoRouterMaxCandidates(),
      routingHint: options?.routingHint || "default",
    });
        const attempts: LlmCandidateAttempt[] = [];

    for (const candidate of decision.candidates) {
            const startedAt = Date.now();
      try {
                const parsed = await this.withTimeout(
          candidate.providerInstance.parseIntent(
            message,
            workflowContext,
            history,
            context,
          ),
          parseIntentTimeoutMs(),
          `parseIntent(${candidate.candidateKey})`,
        );
                const latencyMs = Date.now() - startedAt;
        AutoModelRouterService.reportSuccess(candidate, latencyMs);
        incrementCounter("autopilot_llm_parse_intent_success_total", {
          provider: candidate.provider,
          model: candidate.model,
        });
        observeHistogram("autopilot_llm_parse_intent_latency_ms", latencyMs, {
          provider: candidate.provider,
          model: candidate.model,
        });
        attempts.push({ candidate, ok: true, latencyMs });
        return parsed;
      } catch (err: any) {
        AutoModelRouterService.reportFailure(candidate);
        incrementCounter("autopilot_llm_parse_intent_failure_total", {
          provider: candidate.provider,
          model: candidate.model,
        });
        attempts.push({
          candidate,
          ok: false,
          error: String(err?.message || err || 'Unknown provider failure'),
        });
      }
    }

    logger.error({
      scope: 'llm.service',
      message: 'parseIntent failed across candidates',
      attempted: formatAttemptChain(attempts),
      errors: formatAttemptErrors(attempts),
    });

    // Fallback path: parseIntent can fail on slower OpenAI-compatible providers
    // even when direct generation would still succeed. Try a direct chat answer.
    for (const candidate of decision.candidates) {
      try {
        const directReply = await this.withTimeout(
          candidate.providerInstance.generateReply(
            message,
            workflowContext,
            history,
            context,
            options?.generation,
          ),
          generateReplyTimeoutMs(),
          `generateReply-fallback(${candidate.candidateKey})`,
        );
        const safeReply = String(directReply || '').trim();
        if (safeReply) {
          incrementCounter("autopilot_llm_parse_intent_fallback_total", { reason: "direct_reply_recovery" });
          return {
            type: 'chat',
            reply: safeReply,
          };
        }
      } catch (err: any) {
        logger.warn({
          scope: 'llm.service',
          message: 'parseIntent fallback direct reply failed',
          provider: candidate.provider,
          model: candidate.model,
          errMessage: err?.message || String(err),
        });
      }
    }

    incrementCounter("autopilot_llm_parse_intent_fallback_total", { reason: "all_candidates_failed" });
    return {
      type: 'chat',
      reply: "I couldn't reach the selected model in time. Please try again or switch to a faster model/provider.",
    };
  }

  /**
   * Streams assistant reply chunks from routed candidates with failover.
   *
   * @param message - User message content.
   * @param providerId - Optional provider override.
   * @param model - Optional model override.
   * @param history - Optional conversation history.
   * @param context - Optional retrieved context.
   * @param options - Routing/generation options.
   * @yields Text chunks produced by provider stream/reply.
   * @throws {Error} When all candidates fail or stream errors after emitting chunks.
   */
  static async *streamReply(
    message: string,
    providerId?: string,
    model?: string,
    history?: ConversationMessage[],
    context?: RetrievedContext,
    options?: LlmRoutingOptions,
  ): AsyncGenerator<string> {
        const workflowContext = shortlistWorkflowContext(
      message,
      await buildWorkflowContext(),
      context,
      getRuntimeConfig().llm.replyWorkflowShortlist,
    );
        const decision = await AutoModelRouterService.resolveCandidates({
      providerId,
      model,
      maxCandidates: autoRouterMaxCandidates(),
      routingHint: options?.routingHint || "default",
    });
        const attempts: LlmCandidateAttempt[] = [];

    for (const candidate of decision.candidates) {
            const startedAt = Date.now();
            let emittedChunks = false;
      try {
                const provider = candidate.providerInstance;
        if (provider.generateReplyStream) {
                    const iterator = provider.generateReplyStream(message, workflowContext, history, context, options?.generation)[Symbol.asyncIterator]();
          while (true) {
                        const next = await this.withTimeout(
              iterator.next(),
              streamStallTimeoutMs(),
              `streamReply(${candidate.candidateKey})`,
            );
            if (next.done) break;
            emittedChunks = true;
            yield next.value;
          }
        } else {
                    const reply = await this.withTimeout(
            provider.generateReply(message, workflowContext, history, context, options?.generation),
            generateReplyTimeoutMs(),
            `generateReply(${candidate.candidateKey})`,
          );
          emittedChunks = true;
          yield reply;
        }
                const latencyMs = Date.now() - startedAt;
        AutoModelRouterService.reportSuccess(candidate, latencyMs);
        incrementCounter("autopilot_llm_stream_reply_success_total", {
          provider: candidate.provider,
          model: candidate.model,
        });
        observeHistogram("autopilot_llm_stream_reply_latency_ms", latencyMs, {
          provider: candidate.provider,
          model: candidate.model,
        });
        attempts.push({ candidate, ok: true, latencyMs });
        return;
      } catch (err: any) {
        AutoModelRouterService.reportFailure(candidate);
        incrementCounter("autopilot_llm_stream_reply_failure_total", {
          provider: candidate.provider,
          model: candidate.model,
        });
        attempts.push({
          candidate,
          ok: false,
          error: String(err?.message || err || 'Unknown provider failure'),
        });
        if (emittedChunks) {
          throw err;
        }
      }
    }

    incrementCounter("autopilot_llm_stream_reply_fallback_total", { reason: "all_candidates_failed" });
    throw new Error(`All LLM candidates failed during streamReply: ${formatAttemptChain(attempts)}`);
  }

  /**
    * Resolves a provider instance from auto-router (single candidate) or direct factory fallback.
    *
    * @param providerId - Optional provider override.
    * @param model - Optional model override.
    * @returns Provider instance.
   */
  static async getProvider(providerId?: string, model?: string) {
        const decision = await AutoModelRouterService.resolveCandidates({
      providerId,
      model,
      maxCandidates: 1,
    });
    if (decision.candidates.length) {
      return decision.candidates[0].providerInstance;
    }
    return LLMFactory.getProvider(providerId, model);
  }
}
