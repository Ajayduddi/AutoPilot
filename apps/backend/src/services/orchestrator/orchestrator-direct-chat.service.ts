/**
 * @fileoverview apps/backend/src/services/orchestrator/orchestrator-direct-chat.service.ts
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
import { formatCommonAnswerMarkdown } from '@autopilot/shared';
import {
  buildForcedProceedQuestion,
  buildQuestionFromText,
  shouldForceInteractiveQuestion,
  stripTrailingQuestionPrompt,
} from './orchestrator-question.service';
import { buildInteractiveQuestionSourceMetadata } from './orchestrator-answer.service';
import type { EmailDraftBlockBuild } from './orchestrator-email.service';

type StreamBlock = { type: string; [key: string]: any };

export function prepareDirectChatReply(reply: string): {
  visibleReply: string;
  parsedQuestion: StreamBlock | null;
} {
  const parsedQuestion =
    buildQuestionFromText(reply) ||
    (shouldForceInteractiveQuestion(reply) ? buildForcedProceedQuestion(reply) : null);
  const visibleReply = formatCommonAnswerMarkdown(
    parsedQuestion ? stripTrailingQuestionPrompt(reply) : reply,
  );
  return { visibleReply, parsedQuestion };
}

export function buildEmailDraftSourceMetadata(emailBuild: EmailDraftBlockBuild): string[] {
  return [
    'emailModeUsed: true',
    `emailJsonParseOk: ${emailBuild.emailJsonParseOk ? 'true' : 'false'}`,
    `emailDraftCount: ${emailBuild.emailDraftCount}`,
    `emailFallbackUsed: ${emailBuild.emailFallbackUsed ? 'true' : 'false'}`,
  ];
}

export function buildDirectChatResponseBlocks(input: {
  summaryItems: string[];
  planBlock: StreamBlock;
  visibleReply: string;
  emailBuild: EmailDraftBlockBuild;
  emailModeUsed: boolean;
  parsedQuestion: StreamBlock | null;
  attachmentSourceBlock?: StreamBlock | null;
}): StreamBlock[] {
  return [
    { type: 'summary', items: input.summaryItems },
    input.planBlock,
    ...(input.emailBuild.blocks ?? [{ type: 'markdown', text: input.visibleReply }]),
    ...(input.parsedQuestion ? [input.parsedQuestion] : []),
    ...(input.emailModeUsed
      ? [{ type: 'source', origin: 'Email Draft Mode', metadata: buildEmailDraftSourceMetadata(input.emailBuild) }]
      : []),
    ...(input.parsedQuestion
      ? [{ type: 'source', origin: 'Interactive Question', metadata: buildInteractiveQuestionSourceMetadata(input.parsedQuestion.questionId) }]
      : []),
    ...(input.attachmentSourceBlock ? [input.attachmentSourceBlock] : []),
  ];
}
