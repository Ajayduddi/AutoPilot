/**
 * @fileoverview services/orchestrator.service.
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
import { LLMService } from '../ai-routing/llm.service';
import { WorkflowService } from '../workflow/workflow.service';
import { ChatService } from '../chat.service';
import { ContextService } from '../context/context.service';
import { ApprovalService } from '../approval.service';
import { MainAgentService, extendDecisionReActState } from '../ai-routing/main-agent.service';
import { TemporalService, type TemporalResolutionInput } from '../temporal.service';
import { ChatRepo } from '../../repositories/chat.repo';
import type { ConversationMessage, RetrievedContext } from '../../providers/llm/provider.interface';
import { contextConfig, getContextMaxRetrievalForModel } from '../../config/context.config';
import { createApprovalGateRunShared, executeWorkflowAwaitShared } from '../agent-runtime/workflow-execution.service';
import { buildReActTelemetryMetadata, logReActTelemetry } from '../telemetry/react-telemetry.service';
import { RagService } from '../retrieval/rag.service';
import { PromptContextService } from '../context/prompt-context.service';
import {
  buildCachedContextFallbackAnswer,
  buildCachedWorkflowSourceMetadata,
  buildFollowUpSourceMetadata,
  buildInteractiveQuestionSourceMetadata,
  buildTemporalSourceMetadata,
  generateCachedContextAnswer,
} from './orchestrator-answer.service';
import {
  buildDirectChatResponseBlocks,
  buildEmailDraftSourceMetadata,
  prepareDirectChatReply,
} from './orchestrator-direct-chat.service';
import {
  buildEmailDraftBlocks,
  shouldUseEmailDraftMode,
} from './orchestrator-email.service';
import { logger } from '../../util/logger';
import { formatCommonAnswerMarkdown } from '@autopilot/shared';
import {
  buildForcedProceedQuestion,
  buildQuestionFromText,
  shouldForceInteractiveQuestion,
  stripTrailingQuestionPrompt,
} from './orchestrator-question.service';
import {
  buildThreadEvidencePlan,
  getThreadWorkflowContextWindow,
  selectThreadWorkflowWindowForQuestion,
} from './orchestrator-evidence.service';
import {
  classifyFollowUpRoute,
  isConfirmationLike,
  isDataFetchCommand,
  resolveQuestionForRerun,
} from './orchestrator-route.service';

type StreamBlock = { type: string; [key: string]: any };

type StreamCallbacks = {
    onBlock: (index: number, block: StreamBlock) => void;
    onChunk: (blockIndex: number, content: string) => void;
    onBlockEnd: (blockIndex: number) => void;
};

type AttachmentLike = {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    processingStatus: string;
  extractedText?: string | null;
  structuredMetadata?: unknown;
  previewData?: unknown;
};

type AttachmentChunkLike = {
    attachmentId: string;
    chunkIndex: number;
    content: string;
  tokenCount?: number | null;
  metadata?: unknown;
};

type MainAgentDecision = Awaited<ReturnType<typeof MainAgentService.decide>>;

function estimateTokens(value: string): number {
    const text = String(value || '');
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function truncateToTokenBudget(value: string, maxTokens: number): string {
    const text = String(value || '');
  if (!text) return '';
    const maxChars = Math.max(64, Math.floor(Math.max(1, maxTokens) * 4));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function buildConversationHistoryWithinBudget(messages: any[], maxTotalTokens: number): ConversationMessage[] {
    const normalized = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content || '') }));
  if (!normalized.length) return [];

    const picked: ConversationMessage[] = [];
    let usedTokens = 0;
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
        const message = normalized[i];
        const clipped = truncateToTokenBudget(message.content, contextConfig.maxMessageTokens);
    if (!clipped.trim()) continue;
        const cost = estimateTokens(clipped);
    if (picked.length > 0 && usedTokens + cost > maxTotalTokens) break;
    picked.push({ role: message.role, content: clipped });
    usedTokens += cost;
    if (usedTokens >= maxTotalTokens) break;
  }
  return picked.reverse();
}

function buildAgentPlanDetailBlock(decision: MainAgentDecision): StreamBlock {
    const planSteps: string[] = [];
    const state = decision.reactState;
    const summaryParts: string[] = [];

    const normalizeNextAction = (raw?: string): string => {
        const value = String(raw || '').trim();
    if (!value) return 'review request';
    switch (value) {
      case 'answer_directly':
        return 'answer directly';
      case 'evaluate_workflow_candidates':
        return 'evaluate workflows';
      case 'request_approval':
        return 'request approval';
      case 'execute_workflow':
        return 'execute workflow';
      case 'answer_user_from_workflow_result':
        return 'answer from workflow result';
      case 'ask_for_clarification':
        return 'ask clarification';
      case 'report_selected_workflow_without_execution':
        return 'report selected workflow';
      default:
        return value.replace(/[_-]+/g, ' ');
    }
  };

  if (state) {
    summaryParts.push(`Intent: ${state.intentType || 'unknown'}`);
    if (state.selectedWorkflowKey || state.selectedWorkflowName) {
      summaryParts.push(`Selected: ${state.selectedWorkflowName || state.selectedWorkflowKey}`);
    } else if (state.requestedWorkflowKey) {
      summaryParts.push(`Target: ${state.requestedWorkflowKey}`);
    }
    summaryParts.push(`Next: ${normalizeNextAction(state.nextAction)}`);
    summaryParts.push(`Confidence: ${state.confidence || 'unknown'}`);

        const recentObservations = Array.isArray(state.observations) ? state.observations.slice(-2) : [];
    for (const obs of recentObservations) {
            const line = String(obs?.summary || '').trim();
      if (line) {
        planSteps.push(line);
      }
    }

    if (state.intentType === "workflow") {
      if (state.selectedWorkflowName || state.selectedWorkflowKey || state.requestedWorkflowKey) {
        planSteps.push(
          `Workflow path: ${state.selectedWorkflowName || state.selectedWorkflowKey || state.requestedWorkflowKey}.`,
        );
      }

      if (state.nextAction === "request_approval") {
        planSteps.push("Approval required before execution.");
      } else if (state.nextAction === "execute_workflow") {
        planSteps.push("Execute workflow and return grounded output.");
      } else if (state.nextAction === "answer_user_from_workflow_result") {
        planSteps.push("Respond directly from workflow result.");
      } else if (state.nextAction === "ask_for_clarification") {
        planSteps.push("Need clarification before safe execution.");
      }
    } else {
      planSteps.push("Use conversation/context/attachments and answer directly.");
      if (state.missingEvidence.length > 0) {
        planSteps.push(`Missing evidence: ${state.missingEvidence.slice(0, 2).join("; ")}.`);
      }
    }

    if (state.evidenceSources.length > 0) {
            const evidenceLabel = state.evidenceSources
        .slice(0, 2)
        .map((item) => item.replace(/^workflow_run:/, "workflow run ").replace(/^attachment:/, "attachment "))
        .join(" and ");
      planSteps.push(`Evidence: ${evidenceLabel}.`);
    }
  }

  if (!planSteps.length) {
    planSteps.push("Review request and choose safest next step.");
  }

    const deduped = Array.from(new Set(planSteps.map((step) => String(step || '').trim()).filter(Boolean))).slice(0, 3);
  if (!summaryParts.length) {
    summaryParts.push('Intent: unknown', 'Next: review request');
  }

    const children: StreamBlock[] = [
    {
      type: "markdown",
            text: deduped.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    },
  ];
  if (decision.mode === "workflow" && decision.selectedSubagent) {
    children.push({
      type: "source",
      origin: "Main Agent Selection",
      metadata: [
        `Subagent: ${decision.selectedSubagent.workflowName}`,
        `Workflow key: ${decision.selectedSubagent.workflowKey}`,
        `Provider: ${decision.selectedSubagent.provider}`,
        `Risk: ${decision.riskEvaluation.level}`,
      ],
    });
  }
  return {
    type: "detail_toggle",
    title: "Agent Plan",
    summary: summaryParts.join(" • "),
    meta: { planKind: "main_agent" },
    children,
  };
}

function buildAgentExecutionInput(input: {
    threadId: string;
    traceId: string;
    goal: string;
    planStepId: string;
    params: Record<string, unknown>;
    attachments: AttachmentLike[];
}) {
  return {
    ...input.params,
        _attachments: input.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType })),
    _agent: {
      requestedByAgent: true,
      threadId: input.threadId,
      traceId: input.traceId,
      goal: input.goal,
      planStepId: input.planStepId,
            evidenceRefs: input.attachments.map((a) => ({ attachmentId: a.id, filename: a.filename })),
    },
  };
}

function hasUsableAttachmentEvidence(
  attachments: AttachmentLike[],
    chunks: AttachmentChunkLike[] = [],
): boolean {
  if (chunks.some((c) => (c.content || '').trim().length >= 40)) return true;
  return attachments.some((a) => (a.extractedText || '').trim().length >= 60);
}

function buildStrictGroundedPrompt(input: {
    userQuestion: string;
    attachmentContext: string;
  conversationContext?: string;
}): string {
    const sections = [
    `User question: "${input.userQuestion}"`,
    input.conversationContext ? `Conversation context:\n${input.conversationContext}` : '',
    `Attachment evidence:\n${input.attachmentContext}`,
    `STRICT GROUNDED MODE (MANDATORY):
1. Answer ONLY using the attachment evidence above.
2. Do NOT use outside knowledge, assumptions, or estimates.
3. If required values are missing/ambiguous, reply exactly in this format:
   INSUFFICIENT_EVIDENCE: <what is missing and why>.
4. For numeric answers, show a short calculation line using only evidence values.
5. Keep the answer concise and factual.`,
  ].filter(Boolean);
  return sections.join('\n\n');
}

async function resolveEffectiveAttachments(
  threadId: string,
  userId: string,
  explicitAttachments: AttachmentLike[],
): Promise<AttachmentLike[]> {
  if (explicitAttachments.length) return explicitAttachments;

  // Follow-up turns frequently omit re-attaching the same files.
  // Reuse the most recent processed attachments in the thread so answers remain grounded.
    const all = await ChatRepo.listAttachmentsByThread(threadId);
    const recent = all
    .filter((a: any) => a.userId === userId)
    .filter((a: any) => a.processingStatus === 'processed' || a.processingStatus === 'not_parsable')
    .sort((a: any, b: any) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
    .slice(0, 3);

  return recent as AttachmentLike[];
}

function buildWorkflowRunCacheData(run: any): string {
    const parts: string[] = [];
  if (run?.normalizedOutput !== undefined) {
    parts.push(`normalizedOutput:\n${JSON.stringify(run.normalizedOutput, null, 2)}`);
  }
  if (run?.rawProviderResponse !== undefined) {
    parts.push(`rawProviderResponse:\n${JSON.stringify(run.rawProviderResponse, null, 2)}`);
  }
  if (run?.errorPayload !== undefined) {
    parts.push(`errorPayload:\n${JSON.stringify(run.errorPayload, null, 2)}`);
  }
  return truncateToTokenBudget(parts.join("\n\n"), contextConfig.cacheDataBudgetTokens);
}


function isInsufficientEvidenceText(text: string): boolean {
    const t = String(text || '').trim().toLowerCase();
  if (!t) return true;
  return t.startsWith('insufficient_evidence');
}

// ─── Validation helpers ────────────────────────────────────────────────────────

type WorkflowValidation =
  | { ok: true; workflow: any }
  | { ok: false; reason: string; errorCode: string };

async function resolveAndValidateWorkflow(workflowKey: string): Promise<WorkflowValidation> {
    const workflow = await WorkflowService.getByKeyInternal(workflowKey);

  if (!workflow) {
    return { ok: false, reason: `Workflow '${workflowKey}' was not found.`, errorCode: 'WORKFLOW_NOT_FOUND' };
  }
  if (workflow.archived) {
    return { ok: false, reason: `Workflow '${workflow.name}' is archived and cannot be triggered.`, errorCode: 'WORKFLOW_ARCHIVED' };
  }
  if (!workflow.enabled) {
    return { ok: false, reason: `Workflow '${workflow.name}' is currently disabled.`, errorCode: 'WORKFLOW_DISABLED' };
  }
  if (!workflow.executionEndpoint) {
    return { ok: false, reason: `Workflow '${workflow.name}' has no execution endpoint configured.`, errorCode: 'NO_ENDPOINT' };
  }
  if (workflow.visibility === 'private') {
    // For now, allow — in multi-user mode this would check ownership
  }

  return { ok: true, workflow };
}

// ─── Result formatting ─────────────────────────────────────────────────────────

function formatRunResult(run: any): string[] {
    const items: string[] = [];
    const status = run.status || 'unknown';

  if (status === 'completed') {
    items.push(`✓ Execution completed successfully`);
  } else if (status === 'failed') {
    items.push(`✗ Execution failed`);
  } else {
    items.push(`Status: ${status}`);
  }

  // Duration
  if (run.startedAt && run.finishedAt) {
        const dur = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    if (dur < 1000) items.push(`Duration: ${dur}ms`);
    else items.push(`Duration: ${(dur / 1000).toFixed(1)}s`);
  }

  // Normalized output summary
  if (run.normalizedOutput) {
        const out = run.normalizedOutput;
    if (typeof out === 'string') {
      items.push(out.slice(0, 300));
    } else if (out.message) {
      items.push(String(out.message).slice(0, 300));
    } else if (out.summary) {
      items.push(String(out.summary).slice(0, 300));
    } else {
            const keys = Object.keys(out);
      if (keys.length <= 5) {
        keys.forEach(k => items.push(`${k}: ${JSON.stringify(out[k]).slice(0, 100)}`));
      } else {
        items.push(`Returned ${keys.length} fields`);
      }
    }
  }

  // Error details
  if (run.errorPayload) {
        const err = run.errorPayload;
    items.push(`Error: ${err.error || err.message || JSON.stringify(err).slice(0, 200)}`);
  }

  return items;
}

export const __orchestratorTestUtils = {
  buildQuestionFromText,
  stripTrailingQuestionPrompt,
  formatCommonAnswerMarkdown,
};

// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Primary orchestrator for chat turn execution in the legacy pipeline.
 *
 * @remarks
 * Coordinates deterministic handling, context retrieval, LLM interaction,
 * workflow execution, and block construction for assistant responses.
 *
 * `AgentService` is preferred when enabled; this class remains the robust
 * fallback and compatibility path for non-agent flows.
 */
export class OrchestratorService {
    static async shouldHandleDeterministicTurn(threadId: string, content: string): Promise<boolean> {
    if (!content || !content.trim()) return false;
        const route = await classifyFollowUpRoute(threadId, content);
    return route.kind !== 'none';
  }

  /**
   * Build conversation history from recent messages in the thread.
   * Returns last N user/assistant message pairs as ConversationMessage[].
   */
  private static async buildConversationHistory(threadId: string, model?: string): Promise<ConversationMessage[]> {
    try {
            const allMessages = await ChatService.getMessages(threadId);
            const retrievalPressure = Math.max(getContextMaxRetrievalForModel(model), 1);
            const budget = Math.min(
        contextConfig.targetWindowTokens,
        Math.max(8_000, contextConfig.historyBudgetTokens + retrievalPressure * 512),
      );
      return buildConversationHistoryWithinBudget(allMessages, budget);
    } catch (err) {
      logger.error({ scope: 'orchestrator', message: 'Failed to fetch conversation history', threadId, err });
      return [];
    }
  }

  /** Legacy synchronous handler — kept for non-streaming POST route. */
  static async handleIncomingMessage(
    threadId: string,
    content: string,
    traceId: string,
    userId: string,
    providerId?: string,
    model?: string,
        attachments: AttachmentLike[] = [],
    temporalInput?: TemporalResolutionInput,
  ) {
        const effectiveAttachments = await resolveEffectiveAttachments(threadId, userId, attachments);

    // ── Context retrieval for legacy handler ──
        const retrievalLimit = getContextMaxRetrievalForModel(model);
        const history = await OrchestratorService.buildConversationHistory(threadId, model);
        const promptContext = await PromptContextService.buildHybridThreadPromptContext({
      surface: 'orchestrator',
      threadId,
      userId,
      query: content,
      model,
      temporalInput,
      categories: ['thread_state', 'workflow_run'],
      exactLimit: retrievalLimit,
      semanticLimit: Math.min(3, retrievalLimit),
      includeSemanticWorkflowRuns: true,
      maxDecisionItems: 6,
    });
        const retrievedContext: RetrievedContext | undefined = promptContext.retrievedContext;

        const ragAttachment = await RagService.buildAttachmentContext({
      userId,
      threadId,
      query: content,
      attachments: effectiveAttachments as any,
    });
        const attachmentBundle = {
      promptText: ragAttachment.promptText,
      sourceBlock: ragAttachment.sourceBlock,
    };
        const contentWithAttachments = attachmentBundle.promptText
      ? `${content}\n\n${attachmentBundle.promptText}`
      : content;
        const strictGroundedAttachmentTurn = effectiveAttachments.length > 0;
        const hasEvidence = ragAttachment.hasEvidence || hasUsableAttachmentEvidence(
      effectiveAttachments,
      ragAttachment.chunks.map((chunk) => ({
        attachmentId: chunk.attachmentId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
      })),
    );

        const temporal = TemporalService.answerIfTemporal(content, temporalInput || {});
    if (temporal.detected && temporal.text) {
      return await ChatService.addMessage(threadId, 'assistant', temporal.text, {
        blocks: [
          { type: 'summary', items: ['Main agent handled this as deterministic temporal response (no subagent execution).'] },
          { type: 'markdown', text: temporal.text },
          {
            type: 'source',
            origin: 'Deterministic Clock',
            metadata: buildTemporalSourceMetadata(temporal),
          },
        ],
      });
    }

    // ── Deterministic follow-up routing gate (prevents unwanted reruns) ──
        const route = await classifyFollowUpRoute(threadId, content);
    if (route.kind === 'show_previous') {
      return await ChatService.addMessage(threadId, 'assistant', route.contextItem.content, {
        blocks: [{ type: 'markdown', text: `**Previous Result:**\n\n${route.contextItem.content}` }],
      });
    }
    if (route.kind === 'followup_answer' || route.kind === 'use_cached_choice') {
            const evidencePlan = await buildThreadEvidencePlan({
        threadId,
        question: content,
        preferredWorkflowKey: route.workflowKey,
        fallbackContextItem: route.contextItem,
      });
            const primaryContext = evidencePlan.passA.items[0] || route.contextItem;
            const ageMs = primaryContext?.createdAt
        ? Date.now() - new Date(primaryContext.createdAt).getTime()
        : 0;
            const workflowName = 'Thread context window';
            let contextPass: 'A' | 'B' = 'A';
            let grounded = await generateCachedContextAnswer({
        question: content,
        cacheData: evidencePlan.passA.cacheData,
        workflowName,
        providerId,
        model,
        history,
        context: retrievedContext,
        attachmentContext: attachmentBundle.promptText,
        routingHint: 'reasoning_heavy',
        temporalInput,
      });
            let evidenceExpanded = false;
      if (isInsufficientEvidenceText(grounded)) {
        contextPass = 'B';
        evidenceExpanded = true;
        grounded = await generateCachedContextAnswer({
          question: content,
          cacheData: evidencePlan.passB.cacheData,
          workflowName,
          providerId,
          model,
          history,
          context: retrievedContext,
          attachmentContext: attachmentBundle.promptText,
          routingHint: 'reasoning_heavy',
          temporalInput,
        });
      }
            const workflowsUsed = contextPass === 'A' ? evidencePlan.passA.workflowsUsed : evidencePlan.passB.workflowsUsed;
            const contextsUsed = contextPass === 'A' ? evidencePlan.passA.items.length : evidencePlan.passB.items.length;
            const effectiveWorkflowKey = String((((primaryContext?.metadata || {}) as Record<string, unknown>).workflowKey) || route.workflowKey || '');
            const followupTelemetry = {
        source: 'orchestrator' as const,
        answerMode: 'context_followup',
        threadId,
        traceId,
        workflowKey: effectiveWorkflowKey,
        contextsUsed: contextsUsed || 1,
        workflowsUsed,
        relevantRuns: evidencePlan.telemetry.relevantRuns,
        requestedFields: evidencePlan.telemetry.requestedFields,
        usedFieldExtraction: evidencePlan.telemetry.usedFieldExtraction,
        cacheHit: true,
        rerunAvoided: true,
      };
      logReActTelemetry(followupTelemetry);
            const parsedQuestion = buildQuestionFromText(grounded) || (shouldForceInteractiveQuestion(grounded) ? buildForcedProceedQuestion(grounded) : null);
            const visibleGrounded = formatCommonAnswerMarkdown(parsedQuestion ? stripTrailingQuestionPrompt(grounded) : grounded);

      return await ChatService.addMessage(threadId, 'assistant', visibleGrounded, {
        blocks: [
          { type: 'summary', items: ['Answered from thread context window (no rerun).'] },
          { type: 'markdown', text: visibleGrounded },
          ...(parsedQuestion ? [parsedQuestion] : []),
          {
            type: 'source',
            origin: 'Follow-up Context — thread',
            metadata: buildFollowUpSourceMetadata({
              routeKind: route.kind,
              workflowKey: effectiveWorkflowKey,
              contextsUsed: contextsUsed || 1,
              workflowsUsed,
              contextPass,
              evidenceExpanded,
              dataAgeSeconds: Math.round(ageMs / 1000),
              rerunPromptPending: false,
              parsedQuestionId: parsedQuestion?.questionId,
              telemetry: followupTelemetry,
            }),
          },
          ...(attachmentBundle.sourceBlock ? [attachmentBundle.sourceBlock] : []),
        ],
      });
    }
    if (route.kind === 'explicit_rerun') {
            const intent = { type: 'workflow' as const, workflowKey: route.workflowKey, parameters: {} };
            const validation = await resolveAndValidateWorkflow(intent.workflowKey);
      if (!validation.ok) {
        return await ChatService.addMessage(threadId, 'assistant', validation.reason, {
          blocks: [{ type: 'error', message: validation.reason, code: validation.errorCode }],
        });
      }
      const { workflow } = validation;
            const run = await executeWorkflowAwaitShared({
        ctx: { userId, traceId, threadId },
        workflow: workflow as any,
        payload: {
          ...(intent.parameters || {}),
                    _attachments: effectiveAttachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
          })),
        },
        triggerSource: 'chat',
      });
            const rerunQuestion = await resolveQuestionForRerun(threadId, content);
            const rerunEvidence = buildWorkflowRunCacheData(run);
            let rerunAnswer = '';
      if (run.status === 'completed' && rerunQuestion && rerunEvidence) {
        rerunAnswer = await generateCachedContextAnswer({
          question: rerunQuestion,
          cacheData: rerunEvidence,
          workflowName: workflow.name,
          providerId,
          model,
          history,
          context: retrievedContext,
          attachmentContext: attachmentBundle.promptText,
          routingHint: 'reasoning_heavy',
          temporalInput,
        });
        if (isInsufficientEvidenceText(rerunAnswer)) rerunAnswer = '';
        else rerunAnswer = formatCommonAnswerMarkdown(rerunAnswer);
      }
            const resultItems = formatRunResult(run);
            const summaryText = run.status === 'completed'
        ? rerunAnswer
          ? `Fetched fresh data from **${workflow.name}** and answered your request.`
          : `**${workflow.name}** rerun completed successfully.`
        : `**${workflow.name}** rerun finished with status: ${run.status}.`;
            const rerunTelemetry = {
        source: 'orchestrator' as const,
        answerMode: rerunAnswer ? 'workflow_rerun_answer' : 'workflow_rerun',
        threadId,
        traceId,
        workflowKey: workflow.key,
        contextsUsed: 1,
        workflowsUsed: [workflow.key],
        cacheHit: false,
        rerunAvoided: false,
      };
      logReActTelemetry(rerunTelemetry);
      return await ChatService.addMessage(threadId, 'assistant', summaryText, {
        blocks: [
          ...(rerunAnswer ? [{ type: 'summary', items: [summaryText] }] : []),
          { type: 'workflow_status', workflow: { name: workflow.name, status: run.status, runId: run.id, startedAt: run.startedAt, completedAt: run.finishedAt, timeline: summaryText } },
          ...(rerunAnswer ? [{ type: 'markdown', text: rerunAnswer }] : []),
          { type: run.status === 'failed' ? 'error' : 'result', title: run.status === 'failed' ? 'Execution Failed' : 'Results', items: resultItems, message: resultItems.join(' • ') },
          {
            type: 'source',
            origin: `${workflow.provider.charAt(0).toUpperCase() + workflow.provider.slice(1)} Workflow Engine`,
            metadata: [
              `answerMode: ${rerunAnswer ? 'workflow_rerun_answer' : 'workflow_rerun'}`,
              'routeKind: explicit_rerun',
              `workflow: ${workflow.key}`,
              `run: ${run.id}`,
              ...(rerunQuestion ? [`question: ${rerunQuestion}`] : []),
              ...(route.autoSwitched ? ['autoSwitch: true', `contextWorkflow: ${route.contextWorkflow || 'unknown'}`] : ['autoSwitch: false']),
              ...buildReActTelemetryMetadata(rerunTelemetry),
            ],
          },
          ...(attachmentBundle.sourceBlock ? [attachmentBundle.sourceBlock] : []),
        ],
      });
    }

        const agentDecision = await MainAgentService.decide({
      userMessage: contentWithAttachments,
      providerId,
      model,
      history,
      context: retrievedContext,
      executionAllowed: true,
    });

    if (agentDecision.mode === 'workflow' && agentDecision.selectedSubagent) {
            const validation = await resolveAndValidateWorkflow(agentDecision.selectedSubagent.workflowKey);

      if (!validation.ok) {
        return await ChatService.addMessage(threadId, 'assistant', validation.reason, {
          blocks: [{ type: 'error', message: validation.reason, code: validation.errorCode }],
        });
      }

      const { workflow } = validation;
            const effectiveQuestion = (isConfirmationLike(content) || isDataFetchCommand(content))
        ? (await resolveQuestionForRerun(threadId, content)) || contentWithAttachments
        : contentWithAttachments;

      if (agentDecision.requiresApproval) {
                const approvalDecision = extendDecisionReActState(agentDecision, {
          observation: {
            phase: 'approval',
            summary: `Approval requested for workflow ${workflow.key}.`,
            details: [agentDecision.riskEvaluation.reason],
          },
          nextAction: 'wait_for_user_approval',
          confidence: 'high',
        });
                const planBlock = buildAgentPlanDetailBlock(approvalDecision);
                const pendingRun = await createApprovalGateRunShared({
          ctx: { userId, traceId, threadId },
          workflow: workflow as any,
          payload: buildAgentExecutionInput({
            threadId,
            traceId,
            goal: effectiveQuestion,
            planStepId: agentDecision.planStepId,
            params: {},
            attachments: effectiveAttachments,
          }),
        });

                const approval = await ApprovalService.request(
          pendingRun.id,
          userId,
          `Approve execution of ${workflow.name}`,
          {
            workflowId: workflow.id,
            workflowKey: workflow.key,
            planId: agentDecision.planId,
            planStepId: agentDecision.planStepId,
            riskLevel: agentDecision.riskEvaluation.level,
            riskReason: agentDecision.riskEvaluation.reason,
          },
          { type: 'system', id: 'orchestrator_main_agent' },
        );

                const waitMessage = `Main agent planned **${workflow.name}**, but it requires approval before execution.`;
                const approvalTelemetry = {
          source: 'orchestrator' as const,
          answerMode: 'approval_pending',
          threadId,
          traceId,
          workflowKey: workflow.key,
          contextsUsed: 0,
          workflowsUsed: [workflow.key],
          cacheHit: false,
          rerunAvoided: false,
          confidence: approvalDecision.reactState.confidence,
        };
        logReActTelemetry(approvalTelemetry);
        return await ChatService.addMessage(threadId, 'assistant', waitMessage, {
          blocks: [
            { type: 'summary', items: [waitMessage] },
            planBlock,
            {
              type: 'approval_card',
              approvalId: approval.id,
              summary: `Approve subagent "${workflow.name}" (${agentDecision.riskEvaluation.level} risk).`,
              details: {
                workflow: String(workflow.key),
                risk: agentDecision.riskEvaluation.level,
                reason: agentDecision.riskEvaluation.reason,
              },
              status: 'pending',
              approveActionId: `approve:${approval.id}`,
              rejectActionId: `reject:${approval.id}`,
            },
            {
              type: 'source',
              origin: 'ReAct Telemetry',
              metadata: buildReActTelemetryMetadata(approvalTelemetry),
            },
            ...(attachmentBundle.sourceBlock ? [attachmentBundle.sourceBlock] : []),
          ],
        });
      }

            const cacheResult = await ContextService.evaluateCacheHit(threadId, workflow.key as string, {});
      if (cacheResult.hit) {
                const cacheDecision = extendDecisionReActState(agentDecision, {
          observation: {
            phase: 'observe',
            summary: `Using cached workflow evidence from ${cacheResult.workflowName}.`,
                        details: [`age=${cacheResult.ageSeconds}s`],
          },
          nextAction: 'answer_from_cached_evidence',
          confidence: 'high',
          evidenceSource: `cached_run:${workflow.key}`,
        });
                const planBlock = buildAgentPlanDetailBlock(cacheDecision);
                const groundedCachedAnswer = await generateCachedContextAnswer({
          question: effectiveQuestion,
          cacheData: cacheResult.cachedData,
          workflowName: cacheResult.workflowName,
          providerId,
          model,
          history,
          context: retrievedContext,
          attachmentContext: attachmentBundle.promptText,
          routingHint: 'reasoning_heavy',
        });
                const cachedAnswer = isInsufficientEvidenceText(groundedCachedAnswer)
          ? buildCachedContextFallbackAnswer({
              workflowName: cacheResult.workflowName,
              ageSeconds: cacheResult.ageSeconds,
              cacheData: cacheResult.cachedData,
              attachmentContext: attachmentBundle.promptText,
            })
          : groundedCachedAnswer;
                const parsedQuestion = buildQuestionFromText(cachedAnswer) || (shouldForceInteractiveQuestion(cachedAnswer) ? buildForcedProceedQuestion(cachedAnswer) : null);
                const visibleCachedAnswer = formatCommonAnswerMarkdown(parsedQuestion ? stripTrailingQuestionPrompt(cachedAnswer) : cachedAnswer);
                const cacheTelemetry = {
          source: 'orchestrator' as const,
          answerMode: 'workflow_cached_answer',
          threadId,
          traceId,
          workflowKey: workflow.key,
          contextsUsed: 1,
          workflowsUsed: [workflow.key],
          cacheHit: true,
          rerunAvoided: true,
          confidence: cacheDecision.reactState.confidence,
        };
        logReActTelemetry(cacheTelemetry);
        return await ChatService.addMessage(threadId, 'assistant', visibleCachedAnswer, {
          blocks: [
            { type: 'summary', items: [`Main agent selected subagent **${workflow.name}** from workflow registry.`] },
            planBlock,
            { type: 'markdown', text: visibleCachedAnswer },
            ...(parsedQuestion ? [parsedQuestion] : []),
            { type: 'source', origin: `Cached — ${cacheResult.workflowName}`, metadata: buildCachedWorkflowSourceMetadata({ workflowName: cacheResult.workflowName, workflowKey: workflow.key, ageSeconds: cacheResult.ageSeconds, parsedQuestionId: parsedQuestion?.questionId, telemetry: cacheTelemetry }) },
          ],
        });
      }

            const executionDecision = extendDecisionReActState(agentDecision, {
        observation: {
          phase: 'act',
          summary: `Executing workflow ${workflow.key}.`,
                    details: [`provider=${workflow.provider}`],
        },
        nextAction: 'await_workflow_result',
        confidence: 'high',
      });
            const run = await executeWorkflowAwaitShared({
        ctx: { userId, traceId, threadId },
        workflow: workflow as any,
        payload: buildAgentExecutionInput({
          threadId,
          traceId,
          goal: effectiveQuestion,
          planStepId: agentDecision.planStepId,
          params: {},
          attachments: effectiveAttachments,
        }),
      });

      ContextService.patchWorkflowRunQuestion(threadId, run.id, effectiveQuestion).catch(() => {});
            const completedDecision = extendDecisionReActState(executionDecision, {
        observation: {
                    phase: run.status === 'completed' ? 'answer' : 'observe',
          summary: `Workflow ${workflow.key} finished with status ${run.status}.`,
                    details: [`run=${run.id}`],
        },
                nextAction: run.status === 'completed' ? 'answer_user_from_workflow_result' : 'recover_from_workflow_failure',
        evidenceSource: `workflow_run:${run.id}`,
      });
            const answerFromRun = run.status === 'completed'
        ? await generateCachedContextAnswer({
            question: effectiveQuestion,
            cacheData: buildWorkflowRunCacheData(run),
            workflowName: workflow.name,
            providerId,
            model,
            history,
            context: retrievedContext,
            attachmentContext: attachmentBundle.promptText,
            routingHint: 'reasoning_heavy',
          })
        : '';
            const formattedAnswerFromRun = answerFromRun && !isInsufficientEvidenceText(answerFromRun)
        ? formatCommonAnswerMarkdown(answerFromRun)
        : '';
            const resultItems = formatRunResult(run);
            const summaryText = run.status === 'completed'
        ? `Main agent triggered **${workflow.name}** successfully.`
        : `Main agent triggered **${workflow.name}** with status: ${run.status}.`;
            const executionTelemetry = {
        source: 'orchestrator' as const,
        answerMode: formattedAnswerFromRun ? 'workflow_execution_answer' : 'workflow_execution',
        threadId,
        traceId,
        workflowKey: workflow.key,
        contextsUsed: 1,
        workflowsUsed: [workflow.key],
        cacheHit: false,
        rerunAvoided: false,
        confidence: completedDecision.reactState.confidence,
      };
      logReActTelemetry(executionTelemetry);

      return await ChatService.addMessage(threadId, 'assistant', summaryText, {
        blocks: [
          { type: 'summary', items: [summaryText] },
          buildAgentPlanDetailBlock(completedDecision),
          { type: 'workflow_status', workflow: { name: workflow.name, status: run.status, runId: run.id, startedAt: run.startedAt, completedAt: run.finishedAt, timeline: summaryText } },
          ...(formattedAnswerFromRun ? [{ type: 'markdown', text: formattedAnswerFromRun }] : []),
          { type: run.status === 'failed' ? 'error' : 'result', title: run.status === 'failed' ? 'Execution Failed' : 'Results', items: resultItems, message: resultItems.join(' • ') },
          ...(attachmentBundle.sourceBlock ? [attachmentBundle.sourceBlock] : []),
          {
            type: 'source',
            origin: `${workflow.provider.charAt(0).toUpperCase() + workflow.provider.slice(1)} Workflow Engine`,
            metadata: [
              `Workflow: ${workflow.key}`,
              `Run: ${run.id}`,
              `Provider: ${workflow.provider}`,
              `answerMode: ${formattedAnswerFromRun ? 'workflow_execution_answer' : 'workflow_execution'}`,
              `question: ${effectiveQuestion}`,
              `agentMode: main_orchestrator`,
              `planId: ${agentDecision.planId}`,
              `planStepId: ${agentDecision.planStepId}`,
              `riskEvaluation: ${agentDecision.riskEvaluation.level}`,
              ...buildReActTelemetryMetadata(executionTelemetry),
            ],
          },
        ],
      });
    } else {
            let reply = agentDecision.finalReply || "I didn't quite catch that.";
            const emailModeUsed = shouldUseEmailDraftMode(content) && !strictGroundedAttachmentTurn;
      if (strictGroundedAttachmentTurn) {
        if (!hasEvidence) {
          reply = 'INSUFFICIENT_EVIDENCE: The attached files do not contain enough extracted text/chunks to answer this reliably.';
        } else {
                    const strictPrompt = buildStrictGroundedPrompt({
            userQuestion: content,
            attachmentContext: attachmentBundle.promptText || '',
            conversationContext: promptContext.contextText || '',
          });
                    let generated = '';
          try {
            for await (const chunk of LLMService.streamReply(
              strictPrompt,
              providerId,
              model,
              history,
              retrievedContext,
              emailModeUsed ? { generation: { responseMode: 'email_draft_v1' } } : undefined,
            )) {
              generated += chunk;
            }
            if (generated.trim()) reply = generated.trim();
          } catch {
            // fallback to intent.reply below
          }
        }
      }
            const { visibleReply, parsedQuestion } = prepareDirectChatReply(reply);
            const emailBuild = buildEmailDraftBlocks(visibleReply);
      if (emailModeUsed && !emailBuild.emailJsonParseOk) {
        logger.warn({
          scope: 'orchestrator',
          message: 'email_draft_v1 JSON parse failed, fallback parser used',
          threadId,
          traceId,
          preview: String(reply || '').slice(0, 160),
        });
      }
      return await ChatService.addMessage(threadId, 'assistant', visibleReply, {
        blocks: buildDirectChatResponseBlocks({
          summaryItems: ['Main agent handled this as a direct chat response (no subagent execution).'],
          planBlock: buildAgentPlanDetailBlock(agentDecision),
          visibleReply,
          emailBuild,
          emailModeUsed,
          parsedQuestion,
          attachmentSourceBlock: attachmentBundle.sourceBlock,
        }),
      });
    }
  }

  /**
   * Streaming handler: emits blocks and text chunks via callbacks as they resolve.
   * Saves the final assistant message to DB and returns it.
   */
  static async handleStreamingMessage(
    threadId: string,
    content: string,
    traceId: string,
    userId: string,
    providerId: string | undefined,
    model: string | undefined,
        attachments: AttachmentLike[] = [],
    callbacks: StreamCallbacks,
    temporalInput?: TemporalResolutionInput,
  ): Promise<{ id: string; createdAt: any }> {
        const effectiveAttachments = await resolveEffectiveAttachments(threadId, userId, attachments);

    // ── Context retrieval ──
        const retrievalLimit = getContextMaxRetrievalForModel(model);
        const promptContext = await PromptContextService.buildHybridThreadPromptContext({
      surface: 'orchestrator',
      threadId,
      userId,
      query: content,
      model,
      temporalInput,
      categories: ['thread_state', 'workflow_run'],
      exactLimit: retrievalLimit,
      semanticLimit: Math.min(3, retrievalLimit),
      includeSemanticWorkflowRuns: true,
      maxDecisionItems: 6,
    });

    // ── Build conversation history + retrieved context for LLM ──
        const history = await OrchestratorService.buildConversationHistory(threadId, model);
        const retrievedContext: RetrievedContext | undefined = promptContext.retrievedContext;

        const ragAttachment = await RagService.buildAttachmentContext({
      userId,
      threadId,
      query: content,
      attachments: effectiveAttachments as any,
    });
        const attachmentBundle = {
      promptText: ragAttachment.promptText,
      sourceBlock: ragAttachment.sourceBlock,
    };
        const contentWithAttachments = attachmentBundle.promptText
      ? `${content}\n\n${attachmentBundle.promptText}`
      : content;
        const strictGroundedAttachmentTurn = effectiveAttachments.length > 0;
        const hasEvidence = ragAttachment.hasEvidence || hasUsableAttachmentEvidence(
      effectiveAttachments,
      ragAttachment.chunks.map((chunk) => ({
        attachmentId: chunk.attachmentId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
      })),
    );

        const temporal = TemporalService.answerIfTemporal(content, temporalInput || {});
    if (temporal.detected && temporal.text) {
            const blocks: StreamBlock[] = [];
            let blockIndex = 0;

            const summaryBlock: StreamBlock = {
        type: 'summary',
        items: ['Main agent handled this as deterministic temporal response (no subagent execution).'],
      };
      callbacks.onBlock(blockIndex++, summaryBlock);
      blocks.push(summaryBlock);

            const mdBlock: StreamBlock = { type: 'markdown', text: temporal.text };
      callbacks.onBlock(blockIndex, mdBlock);
      callbacks.onChunk(blockIndex, temporal.text);
      callbacks.onBlockEnd(blockIndex);
      blockIndex += 1;
      blocks.push(mdBlock);

            const sourceBlock: StreamBlock = {
        type: 'source',
        origin: 'Deterministic Clock',
        metadata: buildTemporalSourceMetadata(temporal),
      };
      callbacks.onBlock(blockIndex++, sourceBlock);
      blocks.push(sourceBlock);

            const savedTemporal = await ChatService.addMessage(
        threadId,
        'assistant',
        temporal.text,
        { blocks },
      );
      return savedTemporal;
    }

    // ── Deterministic follow-up routing gate ──
        const route = await classifyFollowUpRoute(threadId, content);

    // Handle "show previous output" entirely locally — no LLM needed
    if (route.kind === 'show_previous') {
            const blocks: StreamBlock[] = [];
            let blockIndex = 0;

            const meta = route.contextItem.metadata as Record<string, unknown> | null;
            const workflowName = (meta?.workflowName as string) || 'Previous workflow';

            const mdBlock: StreamBlock = {
        type: 'markdown',
        text: `**${workflowName} — Previous Result:**\n\n${route.contextItem.content}`,
      };
      callbacks.onBlock(blockIndex, mdBlock);
      callbacks.onChunk(blockIndex, mdBlock.text);
      callbacks.onBlockEnd(blockIndex);
      blocks.push(mdBlock);

      return await ChatService.addMessage(
        threadId, 'assistant',
        mdBlock.text.slice(0, 500),
        { blocks },
      );
    }

    // Handle explicit rerun by overriding intent to the last workflow
        let intent;
        let agentDecision: MainAgentDecision;
    if (route.kind === 'explicit_rerun') {
      agentDecision = {
        mode: 'workflow',
        planId: `plan_retry_${Date.now()}`,
        planStepId: `step_retry_${Date.now()}`,
        reasoning: 'Follow-up retry detected from previous workflow context.',
        reactState: {
          goal: contentWithAttachments,
          intentType: 'workflow',
          requestedWorkflowKey: route.workflowKey,
          candidateCount: 1,
          shortlistedCandidates: [{
            workflowKey: route.workflowKey,
            workflowName: route.workflowKey,
            score: 100,
            reasons: ['Explicit rerun requested from prior workflow context.'],
          }],
          selectedWorkflowKey: route.workflowKey,
          selectedWorkflowName: route.workflowKey,
          evidenceSources: route.contextWorkflow ? [`thread_context:${route.contextWorkflow}`] : ['thread_context'],
          missingEvidence: [],
          confidence: 'high',
          nextAction: 'execute_workflow',
          observations: [
            {
              phase: 'understand',
              summary: 'Follow-up retry detected from previous workflow context.',
              details: route.autoSwitched ? [`autoSwitched from ${route.contextWorkflow || 'unknown'}`] : undefined,
            },
          ],
        },
        selectedSubagent: {
          workflowId: '',
          workflowKey: route.workflowKey,
          workflowName: route.workflowKey,
          provider: 'n8n',
        },
        riskEvaluation: { level: 'low', reason: 'Retry intent' },
        requiresApproval: false,
      };
      intent = { type: 'workflow' as const, workflowKey: route.workflowKey, parameters: {} };
      ContextService.indexAssistantDecision({
        threadId,
        intentType: 'workflow',
        workflowKey: route.workflowKey,
        userMessage: contentWithAttachments,
      }).catch(() => {});
    } else if (route.kind === 'followup_answer' || route.kind === 'use_cached_choice') {
      // Follow-up answer mode: do not execute; answer from latest relevant run context.
            const rawThreadWindow = await getThreadWorkflowContextWindow(threadId, 8);
            const threadWindow = selectThreadWorkflowWindowForQuestion(content, rawThreadWindow, {
        maxItems: 4,
        maxDistinctWorkflows: 3,
        preferredWorkflowKey: route.workflowKey,
      });
            const windowForPrompt = threadWindow.length ? threadWindow : [route.contextItem];
            const answerContext: RetrievedContext = {
        formatted: ContextService.formatForPrompt(windowForPrompt, {
          maxTotalTokens: contextConfig.retrievedContextBudgetTokens,
          maxTokensPerItem: contextConfig.maxContextItemTokens,
        }),
      };
      agentDecision = await MainAgentService.decide({
        userMessage: contentWithAttachments,
        providerId,
        model,
        history,
        context: answerContext,
        executionAllowed: false,
      });
      intent = agentDecision.mode === 'workflow'
        ? { type: 'chat' as const, reply: "I can answer this from the latest result without rerunning. Ask 'rerun now' if you want a fresh execution." }
        : { type: 'chat' as const, reply: agentDecision.finalReply };
    } else {
      agentDecision = await MainAgentService.decide({
        userMessage: contentWithAttachments,
        providerId,
        model,
        history,
        context: retrievedContext,
        executionAllowed: true,
      });
      intent = agentDecision.mode === 'workflow'
        ? { type: 'workflow' as const, workflowKey: agentDecision.selectedSubagent.workflowKey, parameters: {} }
        : { type: 'chat' as const, reply: agentDecision.finalReply };
    }

    // ── Index assistant decision into context memory (skip explicit rerun which is already indexed above) ──
    if (route.kind !== 'explicit_rerun') {
      ContextService.indexAssistantDecision({
        threadId,
        intentType: intent.type,
        workflowKey: intent.workflowKey,
        userMessage: contentWithAttachments,
      }).catch(() => {}); // fire-and-forget, never block
    }

        const blocks: StreamBlock[] = [];
        let blockIndex = 0;

    // ── Workflow path: validate key exists before executing ──
        let workflowValidation: Awaited<ReturnType<typeof resolveAndValidateWorkflow>> | null = null;
    if (intent.type === 'workflow' && intent.workflowKey) {
      workflowValidation = await resolveAndValidateWorkflow(intent.workflowKey);
      if (!workflowValidation.ok && workflowValidation.errorCode === 'WORKFLOW_NOT_FOUND') {
        // LLM hallucinated a workflow key — fall back to chat
        logger.warn({
          scope: 'orchestrator',
          message: `LLM suggested non-existent workflow '${intent.workflowKey}', falling back to chat`,
          threadId,
          traceId,
          workflowKey: intent.workflowKey,
        });
        workflowValidation = null;
        intent = { type: 'chat' as const, reply: undefined, workflowKey: undefined, parameters: undefined };
      }
    }

    if (intent.type === 'workflow' && intent.workflowKey && workflowValidation) {

      if (!workflowValidation.ok) {
                const errorBlock: StreamBlock = {
          type: 'error',
          title: 'Cannot Run Workflow',
          message: workflowValidation.reason,
          code: workflowValidation.errorCode,
        };
        callbacks.onBlock(blockIndex++, errorBlock);
        blocks.push(errorBlock);
      } else {
        const { workflow } = workflowValidation;

        // ── Context-aware decisioning: check cache before executing ──
                const isRetryFollowUp = route.kind === 'explicit_rerun';
                const cacheResult = isRetryFollowUp
          ? { hit: false as const, reason: 'retry_followup' }
          : await ContextService.evaluateCacheHit(threadId, workflow.key, intent.parameters);

        if (cacheResult.hit) {
          // Answer from cached context — skip workflow execution
                    const aiBlockIdx = blockIndex++;
                    const aiBlock: StreamBlock = { type: 'markdown', text: '' };
          blocks.push(aiBlock);
          callbacks.onBlock(aiBlockIdx, { ...aiBlock });

                    const cachePrompt =
            `The user asked: "${content}"\n\n` +
            `A workflow named "${cacheResult.workflowName}" was recently executed (${cacheResult.ageSeconds}s ago) ` +
            `and returned the following cached data:\n` +
            `\`\`\`\n${truncateToTokenBudget(cacheResult.cachedData, Math.min(contextConfig.cacheDataBudgetTokens, 20_000))}\n\`\`\`\n\n` +
            (attachmentBundle.promptText
              ? `Attached files context (same thread):\n${attachmentBundle.promptText}\n\n`
              : '') +
            `INSTRUCTIONS:\n` +
            `1. Answer the user's question DIRECTLY using ONLY the cached data above.\n` +
            `2. When attached file context is present, prefer it for calculations/filters.\n` +
            `3. Quote specific facts, names, numbers, and dates exactly as they appear.\n` +
            `4. Use markdown formatting for readability.\n` +
            `5. Keep the response concise but complete.`;

                    let fullText = '';
          try {
            for await (const chunk of LLMService.streamReply(cachePrompt, providerId, model)) {
              fullText += chunk;
              aiBlock.text = fullText;
              callbacks.onChunk(aiBlockIdx, chunk);
            }
          } catch (err) {
            logger.error({ scope: 'orchestrator', message: 'Cached answer generation failed', threadId, traceId, workflowKey: workflow.key, err });
            fullText = truncateToTokenBudget(cacheResult.cachedData, 8_000);
            aiBlock.text = fullText;
            callbacks.onChunk(aiBlockIdx, fullText);
          }
          callbacks.onBlockEnd(aiBlockIdx);
          aiBlock.text = fullText;

          // Source block indicating cached origin
                    const sourceBlock: StreamBlock = {
            type: 'source',
            origin: `Cached — ${cacheResult.workflowName}`,
            metadata: [
              `From cached run (${cacheResult.ageSeconds}s ago)`,
              `Workflow: ${workflow.key}`,
            ],
          };
          callbacks.onBlock(blockIndex++, sourceBlock);
          blocks.push(sourceBlock);
        } else {
          // ── Fresh execution path ──

                const effectiveQuestion = (isConfirmationLike(content) || isDataFetchCommand(content))
          ? (await resolveQuestionForRerun(threadId, content)) || contentWithAttachments
          : contentWithAttachments;

        // 1. Summary block — immediate feedback
                const summaryBlock: StreamBlock = {
          type: 'summary',
          items: [`Main agent selected **${workflow.name}** and is preparing execution via ${workflow.provider}.`],
        };
        callbacks.onBlock(blockIndex++, summaryBlock);
        blocks.push(summaryBlock);
        if (agentDecision.requiresApproval) {
                    const approvalDecision = extendDecisionReActState(agentDecision, {
            observation: {
              phase: 'approval',
              summary: `Approval requested for workflow ${workflow.key}.`,
              details: [agentDecision.riskEvaluation.reason],
            },
            nextAction: 'wait_for_user_approval',
            confidence: 'high',
          });
                    const planBlock = buildAgentPlanDetailBlock(approvalDecision);
          callbacks.onBlock(blockIndex++, planBlock);
          blocks.push(planBlock);
                    const pendingRun = await createApprovalGateRunShared({
            ctx: { userId, traceId, threadId },
            workflow: workflow as any,
            payload: buildAgentExecutionInput({
              threadId,
              traceId,
              goal: effectiveQuestion,
              planStepId: agentDecision.planStepId,
              params: {},
              attachments: effectiveAttachments,
            }),
          });
                    const approval = await ApprovalService.request(
            pendingRun.id,
            userId,
            `Approve execution of ${workflow.name}`,
            {
              workflowId: workflow.id,
              workflowKey: workflow.key,
              planId: agentDecision.planId,
              planStepId: agentDecision.planStepId,
              riskLevel: agentDecision.riskEvaluation?.level || 'medium',
              riskReason: agentDecision.riskEvaluation?.reason || 'Guarded policy',
            },
            { type: 'system', id: 'orchestrator_stream' },
          );
                    const approvalBlock: StreamBlock = {
            type: 'approval_card',
            approvalId: approval.id,
            summary: `Approve subagent "${workflow.name}" (${agentDecision.riskEvaluation.level} risk).`,
            details: {
              workflow: String(workflow.key),
              risk: agentDecision.riskEvaluation.level,
              reason: agentDecision.riskEvaluation.reason,
            },
            status: 'pending',
            approveActionId: `approve:${approval.id}`,
            rejectActionId: `reject:${approval.id}`,
          };
          callbacks.onBlock(blockIndex++, approvalBlock);
          blocks.push(approvalBlock);
          if (attachmentBundle.sourceBlock) {
            callbacks.onBlock(blockIndex++, attachmentBundle.sourceBlock);
            blocks.push(attachmentBundle.sourceBlock);
          }
                    const savedPending = await ChatService.addMessage(
            threadId,
            'assistant',
            `Main agent planned ${workflow.name}, waiting for approval.`,
            { blocks },
          );
          logReActTelemetry({
            source: 'orchestrator',
            answerMode: 'approval_pending',
            threadId,
            traceId,
            workflowKey: workflow.key,
            contextsUsed: 0,
            workflowsUsed: [workflow.key],
            cacheHit: false,
            rerunAvoided: false,
            confidence: approvalDecision.reactState.confidence,
          });
          return savedPending;
        }

                const executionDecision = extendDecisionReActState(agentDecision, {
          observation: {
            phase: 'act',
            summary: `Executing workflow ${workflow.key}.`,
                        details: [`provider=${workflow.provider}`],
          },
          nextAction: 'await_workflow_result',
          confidence: 'high',
        });
                const planBlock = buildAgentPlanDetailBlock(executionDecision);
        callbacks.onBlock(blockIndex++, planBlock);
        blocks.push(planBlock);

        // 2. Workflow status block — shows "running" state
                const workflowBlock: StreamBlock = {
          type: 'workflow_status',
          workflow: {
            name: workflow.name,
            status: 'running',
            runId: '', // will be updated
            startedAt: new Date().toISOString(),
            timeline: 'Execution in progress',
            details: { workflow_key: workflow.key, provider: workflow.provider },
          },
        };
        callbacks.onBlock(blockIndex++, workflowBlock);
        blocks.push(workflowBlock);

        // 3. Execute and AWAIT result
                const run = await executeWorkflowAwaitShared({
          ctx: { userId, traceId, threadId },
          workflow: workflow as any,
          payload: buildAgentExecutionInput({
            threadId,
            traceId,
            goal: effectiveQuestion,
            planStepId: agentDecision.planStepId,
            params: intent.parameters || {},
            attachments: effectiveAttachments,
          }),
        });
                const rerunQuestion = isRetryFollowUp ? await resolveQuestionForRerun(threadId, content) : null;
                const answerQuestion = rerunQuestion || effectiveQuestion;

        // Enrich context memory with original user question
        // (WorkflowService already indexed the run, but without the question)
        ContextService.updateThreadState({
          threadId,
          lastWorkflowKey: workflow.key,
          lastWorkflowRunId: run.id,
          lastWorkflowStatus: run.status,
          lastWorkflowName: workflow.name,
          lastSubject: answerQuestion.slice(0, 200),
        }).catch(() => {});

        // Patch the user's question into the workflow run context for follow-up search
        ContextService.patchWorkflowRunQuestion(threadId, run.id, answerQuestion).catch(() => {});
                const completedDecision = extendDecisionReActState(executionDecision, {
          observation: {
                        phase: run.status === 'completed' ? 'answer' : 'observe',
            summary: `Workflow ${workflow.key} finished with status ${run.status}.`,
                        details: [`run=${run.id}`],
          },
                    nextAction: run.status === 'completed' ? 'answer_user_from_workflow_result' : 'recover_from_workflow_failure',
          evidenceSource: `workflow_run:${run.id}`,
        });

        // Update the workflow block with final status
        workflowBlock.workflow.status = run.status;
        workflowBlock.workflow.runId = run.id;
        workflowBlock.workflow.completedAt = run.finishedAt;
        workflowBlock.workflow.timeline = run.status === 'completed' ? 'Completed' : run.status === 'failed' ? 'Execution failed' : run.status;

        // Re-emit the updated workflow block
        callbacks.onBlock(blockIndex - 1, workflowBlock);

        // 4. Result or Error block
                const resultItems = formatRunResult(run);
        if (run.status === 'failed') {
                    const errorBlock: StreamBlock = {
            type: 'error',
            title: 'Execution Failed',
            message: resultItems.join(' • '),
            code: 'WORKFLOW_EXECUTION_FAILED',
          };
          callbacks.onBlock(blockIndex++, errorBlock);
          blocks.push(errorBlock);
        } else {
                    const resultBlock: StreamBlock = {
            type: 'result',
            title: 'Results',
            items: resultItems,
          };
          callbacks.onBlock(blockIndex++, resultBlock);
          blocks.push(resultBlock);

          // 4b. AI-generated summary of the workflow results
                    const aiBlockIdx = blockIndex++;
                    const aiBlock: StreamBlock = { type: 'markdown', text: '' };
          blocks.push(aiBlock);
          callbacks.onBlock(aiBlockIdx, { ...aiBlock });

                    const resultData = run.normalizedOutput
            ? truncateToTokenBudget(JSON.stringify(run.normalizedOutput, null, 2), Math.min(contextConfig.cacheDataBudgetTokens, 20_000))
            : resultItems.join('\n');

                    const summaryPrompt =
            `The user asked: "${answerQuestion}"\n\n` +
            `A workflow named "${workflow.name}" was executed and returned the following JSON data:\n` +
            `\`\`\`json\n${resultData}\n\`\`\`\n\n` +
            `INSTRUCTIONS:\n` +
            `1. Answer the user's original question DIRECTLY and ACCURATELY using ONLY the data above.\n` +
            `2. Extract the specific facts/values from the data that answer their question — do not paraphrase or generalize.\n` +
            `3. If the data contains names, numbers, dates, or locations, quote them exactly as they appear.\n` +
            `4. Use markdown formatting for readability.\n` +
            `5. Keep the response concise but complete — include all relevant details from the data.`;

                    let fullSummary = '';
          try {
            for await (const chunk of LLMService.streamReply(summaryPrompt, providerId, model)) {
              fullSummary += chunk;
              aiBlock.text = fullSummary;
              callbacks.onChunk(aiBlockIdx, chunk);
            }
          } catch (err) {
            logger.error({ scope: 'orchestrator', message: 'AI summary generation failed', threadId, traceId, workflowKey: workflow.key, err });
            fullSummary = resultItems.join('\n');
            aiBlock.text = fullSummary;
            callbacks.onChunk(aiBlockIdx, fullSummary);
          }
          callbacks.onBlockEnd(aiBlockIdx);
          fullSummary = formatCommonAnswerMarkdown(fullSummary);
          aiBlock.text = fullSummary;
        }

        // 5. Source metadata block
                const sourceBlock: StreamBlock = {
          type: 'source',
          origin: `${workflow.provider.charAt(0).toUpperCase() + workflow.provider.slice(1)} Workflow Engine`,
          metadata: [
            `Workflow: ${workflow.key}`,
            `Run: ${run.id}`,
            `Provider: ${workflow.provider}`,
            `answerMode: ${isRetryFollowUp ? 'workflow_rerun_answer' : 'workflow_execution'}`,
            `routeKind: ${route.kind}`,
            `agentMode: main_orchestrator`,
            `planId: ${agentDecision.planId}`,
            `planStepId: ${agentDecision.planStepId}`,
            `selectedSubagent: ${workflow.key}`,
            `riskEvaluation: ${agentDecision.riskEvaluation?.level || 'unknown'}`,
            `reactNextAction: ${completedDecision.reactState.nextAction}`,
            `reactConfidence: ${completedDecision.reactState.confidence}`,
            ...buildReActTelemetryMetadata({
              source: 'orchestrator',
              answerMode: isRetryFollowUp ? 'workflow_rerun_answer' : 'workflow_execution',
              threadId,
              traceId,
              workflowKey: workflow.key,
              contextsUsed: 1,
              workflowsUsed: [workflow.key],
              cacheHit: false,
              rerunAvoided: false,
              confidence: completedDecision.reactState.confidence,
            }),
            ...(rerunQuestion ? [`question: ${rerunQuestion}`] : []),
            ...(route.kind === 'explicit_rerun'
              ? [
                  `autoSwitch: ${route.autoSwitched ? 'true' : 'false'}`,
                  ...(route.contextWorkflow ? [`contextWorkflow: ${route.contextWorkflow}`] : []),
                ]
              : []),
          ],
        };
        logReActTelemetry({
          source: 'orchestrator',
          answerMode: isRetryFollowUp ? 'workflow_rerun_answer' : 'workflow_execution',
          threadId,
          traceId,
          workflowKey: workflow.key,
          contextsUsed: 1,
          workflowsUsed: [workflow.key],
          cacheHit: false,
          rerunAvoided: false,
          confidence: completedDecision.reactState.confidence,
        });
        callbacks.onBlock(blockIndex++, sourceBlock);
        blocks.push(sourceBlock);
        if (attachmentBundle.sourceBlock) {
          callbacks.onBlock(blockIndex++, attachmentBundle.sourceBlock);
          blocks.push(attachmentBundle.sourceBlock);
        }

        // 6. Actions block
                const actionsBlock: StreamBlock = {
          type: 'actions',
          items: [
            { id: 'view-run', label: 'View Run', variant: 'primary', entityId: run.id },
            ...(run.status === 'failed' ? [{ id: 'retry-workflow', label: 'Retry', variant: 'secondary', entityId: workflow.id }] : []),
          ],
        };
        callbacks.onBlock(blockIndex++, actionsBlock);
        blocks.push(actionsBlock);
        } // end fresh execution path
      } // end validation.ok + cache-hit/miss
    } else {
      // Chat reply — stream tokens from LLM
      // For deterministic follow-ups, answer from latest relevant run context unless user explicitly requested rerun.
            const isFollowupAnswerRoute = route.kind === 'followup_answer' || route.kind === 'use_cached_choice';
            const followupCtx = isFollowupAnswerRoute ? route.contextItem : null;
            const chatContext = followupCtx
        ? {
            formatted: ContextService.formatForPrompt([followupCtx], {
              maxTotalTokens: contextConfig.retrievedContextBudgetTokens,
              maxTokensPerItem: contextConfig.maxContextItemTokens,
            }),
          }
        : retrievedContext;

            const summaryBlock: StreamBlock = {
        type: 'summary',
        items: ['Main agent handled this as direct chat response (no subagent execution).'],
      };
      callbacks.onBlock(blockIndex++, summaryBlock);
      blocks.push(summaryBlock);
            const planBlock = buildAgentPlanDetailBlock(agentDecision);
      callbacks.onBlock(blockIndex++, planBlock);
      blocks.push(planBlock);

            const textBlockIdx = blockIndex++;
            const textBlock: StreamBlock = { type: 'markdown', text: '' };
      blocks.push(textBlock);
      // Emit an empty block first so the frontend knows a text block is incoming
      callbacks.onBlock(textBlockIdx, { ...textBlock });

            let fullText = '';
            let questionBlock: StreamBlock | null = null;
            const emailModeUsed = shouldUseEmailDraftMode(content) && !strictGroundedAttachmentTurn;
            let stalePromptPending = false;
            let followupMeta: {
                workflowKey: string;
                contextsUsed: number;
                workflowsUsed: string[];
                contextPass: 'A' | 'B';
                evidenceExpanded: boolean;
                dataAgeSeconds: number;
      } | null = null;
      try {
        if (isFollowupAnswerRoute && followupCtx) {
                    const evidencePlan = await buildThreadEvidencePlan({
            threadId,
            question: content,
            preferredWorkflowKey: String((followupCtx?.metadata as any)?.workflowKey || (route as any).workflowKey || ''),
            fallbackContextItem: followupCtx,
          });
                    const primaryContext = evidencePlan.passA.items[0] || followupCtx;
                    const ageMs = primaryContext?.createdAt
            ? Date.now() - new Date(primaryContext.createdAt).getTime()
            : 0;
                    const workflowName = 'thread context window';
                    let contextPass: 'A' | 'B' = 'A';
                    let evidenceExpanded = false;
          fullText = await generateCachedContextAnswer({
            question: content,
            cacheData: evidencePlan.passA.cacheData,
            workflowName,
            providerId,
            model,
            history,
            context: chatContext,
            attachmentContext: attachmentBundle.promptText,
            routingHint: 'reasoning_heavy',
          });
          if (isInsufficientEvidenceText(fullText)) {
            contextPass = 'B';
            evidenceExpanded = true;
            fullText = await generateCachedContextAnswer({
              question: content,
              cacheData: evidencePlan.passB.cacheData,
              workflowName,
              providerId,
              model,
              history,
              context: chatContext,
              attachmentContext: attachmentBundle.promptText,
              routingHint: 'reasoning_heavy',
            });
          }
          textBlock.text = fullText;
          callbacks.onChunk(textBlockIdx, fullText);
          questionBlock = buildQuestionFromText(fullText) || (shouldForceInteractiveQuestion(fullText) ? buildForcedProceedQuestion(fullText) : null);
          if (questionBlock) {
            fullText = stripTrailingQuestionPrompt(fullText);
          }
          fullText = formatCommonAnswerMarkdown(fullText);
          textBlock.text = fullText;
          stalePromptPending = false;
                    const usedItems = contextPass === 'A' ? evidencePlan.passA.items : evidencePlan.passB.items;
                    const usedWorkflows = contextPass === 'A' ? evidencePlan.passA.workflowsUsed : evidencePlan.passB.workflowsUsed;
          followupMeta = {
            workflowKey: String((((primaryContext?.metadata || {}) as Record<string, unknown>).workflowKey) || (route as any).workflowKey || ''),
            contextsUsed: usedItems.length || 1,
            workflowsUsed: usedWorkflows,
            contextPass,
            evidenceExpanded,
            dataAgeSeconds: Math.round(ageMs / 1000),
          };
        } else {
                const groundedPrompt = (strictGroundedAttachmentTurn && hasEvidence)
          ? buildStrictGroundedPrompt({
              userQuestion: content,
              attachmentContext: attachmentBundle.promptText || '',
              conversationContext: chatContext?.formatted || '',
            })
          : contentWithAttachments;
                const noEvidenceStrictReply = 'INSUFFICIENT_EVIDENCE: The attached files do not contain enough extracted text/chunks to answer this reliably.';

        if (strictGroundedAttachmentTurn && !hasEvidence) {
          fullText = noEvidenceStrictReply;
          textBlock.text = fullText;
          callbacks.onChunk(textBlockIdx, fullText);
        } else {
          for await (const chunk of LLMService.streamReply(
            groundedPrompt,
            providerId,
            model,
            history,
            chatContext,
            emailModeUsed ? { generation: { responseMode: 'email_draft_v1' } } : undefined,
          )) {
            fullText += chunk;
            textBlock.text = fullText;
            callbacks.onChunk(textBlockIdx, chunk);
          }
        }
        }
      } catch (err) {
                const fallback = strictGroundedAttachmentTurn
          ? 'INSUFFICIENT_EVIDENCE: I could not produce a fully grounded answer from the provided attachment evidence.'
          : (agentDecision.mode === 'chat' ? (agentDecision.finalReply || "I couldn't generate a response at this time.") : "I couldn't generate a response at this time.");
        fullText = fallback;
        textBlock.text = fullText;
        callbacks.onChunk(textBlockIdx, fallback);
        questionBlock = buildQuestionFromText(fullText) || (shouldForceInteractiveQuestion(fullText) ? buildForcedProceedQuestion(fullText) : null);
        if (questionBlock) {
          fullText = stripTrailingQuestionPrompt(fullText);
        }
        fullText = formatCommonAnswerMarkdown(fullText);
        textBlock.text = fullText;
      }
      if (!emailModeUsed) {
        fullText = formatCommonAnswerMarkdown(fullText);
        textBlock.text = fullText;
      }
      callbacks.onBlockEnd(textBlockIdx);
            const emailBuild = buildEmailDraftBlocks(fullText);
      if (emailModeUsed && !emailBuild.emailJsonParseOk) {
        logger.warn({
          scope: 'orchestrator',
          message: 'streaming email_draft_v1 JSON parse failed, fallback parser used',
          threadId,
          traceId,
          preview: String(fullText || '').slice(0, 160),
        });
      }
      if (emailBuild.blocks) {
                const replacementBlocks: StreamBlock[] = [...emailBuild.blocks];
        blocks.splice(textBlockIdx, 1, ...replacementBlocks);
        callbacks.onBlock(textBlockIdx, replacementBlocks[0]);
        for (let i = 1; i < replacementBlocks.length; i += 1) {
          callbacks.onBlock(textBlockIdx + i, replacementBlocks[i]);
        }
        blockIndex += replacementBlocks.length - 1;
      } else {
        textBlock.text = fullText;
      }
      if (questionBlock) {
        callbacks.onBlock(blockIndex++, questionBlock);
        blocks.push(questionBlock);
      }
      if (emailModeUsed) {
                const emailSource: StreamBlock = {
          type: 'source',
          origin: 'Email Draft Mode',
          metadata: buildEmailDraftSourceMetadata(emailBuild),
        };
        callbacks.onBlock(blockIndex++, emailSource);
        blocks.push(emailSource);
      }
      if (isFollowupAnswerRoute && followupCtx) {
                const workflowName = 'thread';
                const workflowKey = followupMeta?.workflowKey || String((followupCtx?.metadata as any)?.workflowKey || (route as any).workflowKey || '');
                const followupSource: StreamBlock = {
          type: 'source',
          origin: `Follow-up Context — ${workflowName}`,
          metadata: buildFollowUpSourceMetadata({
            routeKind: route.kind,
            workflowKey,
            contextsUsed: followupMeta?.contextsUsed || 1,
            workflowsUsed: followupMeta?.workflowsUsed || [workflowKey],
            contextPass: followupMeta?.contextPass || 'A',
            evidenceExpanded: followupMeta?.evidenceExpanded || false,
            dataAgeSeconds: followupMeta?.dataAgeSeconds ?? 0,
            rerunPromptPending: stalePromptPending,
            parsedQuestionId: questionBlock?.questionId,
          }),
        };
        callbacks.onBlock(blockIndex++, followupSource);
        blocks.push(followupSource);
      } else if (questionBlock) {
                const questionSource: StreamBlock = {
          type: 'source',
          origin: 'Interactive Question',
          metadata: buildInteractiveQuestionSourceMetadata(questionBlock.questionId),
        };
        callbacks.onBlock(blockIndex++, questionSource);
        blocks.push(questionSource);
      }
      if (attachmentBundle.sourceBlock) {
        callbacks.onBlock(blockIndex++, attachmentBundle.sourceBlock);
        blocks.push(attachmentBundle.sourceBlock);
      }
    }

    // Persist the final assembled message
        const contentSummary = blocks
      .filter(b => b.type === 'markdown' || b.type === 'text' || b.type === 'email_draft')
      .map(b => b.type === 'email_draft'
        ? `Subject: ${String(b.subject || '')}\n\n${String(b.body || '')}`
        : String(b.text || ''),
      )
      .filter(Boolean)
      .join(' ')
      .slice(0, 500);

        const saved = await ChatService.addMessage(
      threadId,
      'assistant',
      contentSummary || '[workflow triggered]',
      { blocks },
    );

    return saved;
  }
}
