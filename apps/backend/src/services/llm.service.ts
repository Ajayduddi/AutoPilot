/**
 * @fileoverview services/llm.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { LLMFactory } from '../providers/llm/llm.factory';
import { WorkflowService } from './workflow.service';
import type {
  ParsedIntent,
  ConversationMessage,
  RetrievedContext,
  WorkflowContext,
  LlmGenerationOptions,
} from '../providers/llm/provider.interface';
import { AutoModelRouterService, type AutoRouterCandidate } from './auto-router.service';
import { incrementCounter, observeHistogram } from '../util/metrics';
import { logger } from '../util/logger';
import { getRuntimeConfig } from '../config/runtime.config';
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

/**
 * Reads max candidate count for auto-router from environment.
 *
 * @returns Maximum number of model candidates to evaluate.
 */
function autoRouterMaxCandidates(): number {
  return Number(process.env.AUTO_ROUTER_MAX_CANDIDATES || '8');
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

const WORKFLOW_CONTEXT_CACHE_TTL_MS = Number(process.env.WORKFLOW_CONTEXT_CACHE_TTL_MS || '30000');
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
    expiresAt: now + WORKFLOW_CONTEXT_CACHE_TTL_MS,
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
      Number(process.env.LLM_INTENT_WORKFLOW_SHORTLIST || '8'),
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
    });
    incrementCounter("autopilot_llm_parse_intent_fallback_total", { reason: "all_candidates_failed" });
    return {
      type: 'chat',
      reply: "Sorry, I lost connection to my AI provider backend. Please check the configurations."
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
      Number(process.env.LLM_REPLY_WORKFLOW_SHORTLIST || '10'),
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
