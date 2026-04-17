/**
 * @fileoverview apps/backend/src/services/orchestrator/orchestrator-answer.service.ts
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
import type { ConversationMessage, RetrievedContext } from '../../providers/llm/provider.interface';
import { contextConfig } from '../../config/context.config';
import { LLMService } from '../ai-routing/llm.service';
import { buildRuntimeClockPromptSection } from '../context/prompt-context.service';
import type { TemporalResolutionInput } from '../temporal.service';
import { buildReActTelemetryMetadata, type ReActTelemetryEvent } from '../telemetry/react-telemetry.service';

function truncateToTokenBudget(value: string, maxTokens: number): string {
  const text = String(value || '');
  if (!text) return '';
  const maxChars = Math.max(64, Math.floor(Math.max(1, maxTokens) * 4));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

export function buildTemporalSourceMetadata(answer: {
  timezoneUsed?: string;
  source?: string;
  generatedAt?: string;
}): string[] {
  return [
    'answerMode: deterministic_temporal',
    `timezone: ${answer.timezoneUsed || 'UTC'}`,
    `source: ${answer.source || 'deterministic_clock'}`,
    `generatedAt: ${answer.generatedAt || new Date().toISOString()}`,
  ];
}

export function buildInteractiveQuestionSourceMetadata(questionId: string): string[] {
  return [
    'answerMode: interactive_question',
    `questionId: ${questionId}`,
  ];
}

export function buildFollowUpSourceMetadata(input: {
  routeKind: string;
  workflowKey: string;
  contextsUsed: number;
  workflowsUsed: string[];
  contextPass: 'A' | 'B';
  evidenceExpanded: boolean;
  dataAgeSeconds: number;
  rerunPromptPending: boolean;
  parsedQuestionId?: string;
  telemetry?: ReActTelemetryEvent;
}): string[] {
  return [
    ...(input.parsedQuestionId ? buildInteractiveQuestionSourceMetadata(input.parsedQuestionId) : []),
    'answerMode: context_followup',
    `routeKind: ${input.routeKind}`,
    `workflow: ${input.workflowKey}`,
    'contextScope: thread_window',
    `contextsUsed: ${input.contextsUsed || 1}`,
    `workflowsUsed: ${input.workflowsUsed.join('|') || input.workflowKey}`,
    `contextPass: ${input.contextPass}`,
    `evidenceExpanded: ${input.evidenceExpanded ? 'true' : 'false'}`,
    'modelTier: preferred_reasoning',
    `dataAgeSeconds: ${input.dataAgeSeconds}`,
    `rerunPromptPending: ${input.rerunPromptPending ? 'true' : 'false'}`,
    ...(input.telemetry ? buildReActTelemetryMetadata(input.telemetry) : []),
  ];
}

export function buildCachedWorkflowSourceMetadata(input: {
  workflowName: string;
  workflowKey: string;
  ageSeconds: number;
  parsedQuestionId?: string;
  telemetry?: ReActTelemetryEvent;
}): string[] {
  return [
    ...(input.parsedQuestionId ? buildInteractiveQuestionSourceMetadata(input.parsedQuestionId) : []),
    `From cached run (${input.ageSeconds}s ago)`,
    `Workflow: ${input.workflowKey}`,
    ...(input.telemetry ? buildReActTelemetryMetadata(input.telemetry) : []),
  ];
}

export function buildCachedContextFallbackAnswer(input: {
  workflowName: string;
  ageSeconds?: number;
  cacheData: string;
  attachmentContext?: string;
}): string {
  return `Based on the recent **${input.workflowName}** run${typeof input.ageSeconds === 'number' ? ` (${input.ageSeconds}s ago)` : ''}:\n\n${truncateToTokenBudget(input.cacheData, 8_000)}${input.attachmentContext ? `\n\n${input.attachmentContext}` : ''}`;
}

export async function generateCachedContextAnswer(input: {
  question: string;
  cacheData: string;
  workflowName: string;
  providerId?: string;
  model?: string;
  history?: ConversationMessage[];
  context?: RetrievedContext;
  attachmentContext?: string;
  routingHint?: 'default' | 'reasoning_heavy';
  temporalInput?: TemporalResolutionInput;
}): Promise<string> {
  const prompt =
    `${buildRuntimeClockPromptSection(input.temporalInput)}\n\n` +
    `The user asked: "${input.question}"\n\n` +
    `Recent workflow result from "${input.workflowName}":\n` +
    `\`\`\`\n${truncateToTokenBudget(input.cacheData, Math.min(contextConfig.cacheDataBudgetTokens, 20_000))}\n\`\`\`\n\n` +
    (input.attachmentContext ? `Attached files context:\n${input.attachmentContext}\n\n` : '') +
    `INSTRUCTIONS:\n` +
    `1. Answer strictly from the workflow/attachment evidence above.\n` +
    `2. Do NOT trigger or suggest execution unless the user explicitly asked to rerun.\n` +
    `3. If evidence is missing, say INSUFFICIENT_EVIDENCE.\n` +
    `4. Keep answer concise and factual.`;

  let text = '';
  try {
    for await (const chunk of LLMService.streamReply(
      prompt,
      input.providerId,
      input.model,
      input.history,
      input.context,
      { routingHint: input.routingHint || 'reasoning_heavy' },
    )) {
      text += chunk;
    }
  } catch {
    text = truncateToTokenBudget(input.cacheData, Math.min(contextConfig.cacheDataBudgetTokens, 8_000));
  }

  return (text || '').trim() || 'INSUFFICIENT_EVIDENCE: Unable to ground an answer from the latest workflow result.';
}
