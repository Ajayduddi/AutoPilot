/**
 * @fileoverview services/orchestrator.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { LLMService } from './llm.service';
import { WorkflowService } from './workflow.service';
import { ChatService } from './chat.service';
import { ContextService } from './context.service';
import { ApprovalService } from './approval.service';
import { MainAgentService, extendDecisionReActState } from './main-agent.service';
import { TemporalService, type TemporalResolutionInput } from './temporal.service';
import { isInteractiveQuestionEnforced } from '../config/runtime.config';
import { ChatRepo } from '../repositories/chat.repo';
import type { ConversationMessage, RetrievedContext } from '../providers/llm/provider.interface';
import { contextConfig, getContextMaxRetrievalForModel } from '../config/context.config';
import { createApprovalGateRunShared, executeWorkflowAwaitShared } from './agent-runtime/workflow-execution.service';
import { buildReActTelemetryMetadata, logReActTelemetry } from './react-telemetry.service';
import { logger } from '../util/logger';

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

type ParsedEmailDraft = {
  label?: string;
  intro?: string;
    subject: string;
    body: string;
  outro?: string;
};

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

function parseSingleEmailDraft(text: string): ParsedEmailDraft | null {
    const raw = String(text || '').trim();
  if (!raw) return null;

    const subjectMatch = raw.match(/(?:^|\n)\s*\**subject\**\s*:\s*(.+)/i);
  if (!subjectMatch || !subjectMatch[1]?.trim()) return null;

    const subjectLine = subjectMatch[0];
    const subjectIndex = raw.indexOf(subjectLine);
  if (subjectIndex < 0) return null;

    const intro = raw.slice(0, subjectIndex).trim();
    const afterSubject = raw.slice(subjectIndex + subjectLine.length).trim();
  if (!afterSubject) return null;

    const outroMatch = afterSubject.match(
    /(?:\n{2,}|\n)\s*(?:[*_`>-]+\s*)?(want me to|would you like|if you'd like|if you want,|let me know if you'd like|just let me know|i can also|i can\b|i could\b|tips?:|feel free to)/i,
  );

    const body = (outroMatch ? afterSubject.slice(0, outroMatch.index ?? 0) : afterSubject).trim();
    const outro = (outroMatch ? afterSubject.slice(outroMatch.index ?? 0) : '').trim();
  if (!body) return null;

    const bodyLines = body.split('\n').map((line) => line.trim()).filter(Boolean);
    const hasGreeting = bodyLines.some((line) => /^(dear|hi|hello|respected)\b/i.test(line));
  if (!hasGreeting && bodyLines.length < 3) return null;

  return {
    intro: intro || undefined,
    subject: subjectMatch[1].trim().replace(/^\**|\**$/g, ''),
    body,
    outro: outro || undefined,
  };
}

type ParsedEmailEnvelope = {
  intro?: string;
    drafts: Array<{ label?: string; subject: string; bodyMarkdown: string }>;
  outro?: string;
};

function safeJsonParseFromText<T>(text: string): T | null {
    const raw = String(text || '').trim();
  if (!raw) return null;
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] || raw;
    const jsonMatch = candidate.match(/\{[\s\S]*\}/);
    const input = jsonMatch ? jsonMatch[0] : candidate;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

function parseEmailEnvelope(text: string): ParsedEmailEnvelope | null {
    const parsed = safeJsonParseFromText<ParsedEmailEnvelope>(text);
  if (!parsed || typeof parsed !== 'object') return null;
  if (!Array.isArray(parsed.drafts) || parsed.drafts.length === 0) return null;
    const drafts = parsed.drafts
    .map((draft) => ({
            label: typeof draft?.label === 'string' ? draft.label.trim() : undefined,
            subject: typeof draft?.subject === 'string' ? draft.subject.trim() : '',
            bodyMarkdown: typeof draft?.bodyMarkdown === 'string' ? draft.bodyMarkdown.trim() : '',
    }))
    .filter((draft) => draft.subject && draft.bodyMarkdown);
  if (!drafts.length) return null;
  return {
        intro: typeof parsed.intro === 'string' ? parsed.intro.trim() || undefined : undefined,
    drafts,
        outro: typeof parsed.outro === 'string' ? parsed.outro.trim() || undefined : undefined,
  };
}

const EMAIL_SUBJECT_GLOBAL_PATTERN = /(?:^|\n)\s*\**subject\**\s*:\s*.+/gi;
const EMAIL_VARIANT_KEYWORDS_PATTERN = /\b(professional|friendly|formal|informal|casual|official|colleague|client|boss|elegant|fun|option|version|draft)\b/i;

function normalizeVariantHeading(line: string): string {
  return String(line || '')
    .trim()
    .replace(/[*_`#>~\-]/g, ' ')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isVariantHeaderLine(line: string): boolean {
    const normalized = normalizeVariantHeading(line);
  if (!normalized) return false;
  if (normalized.length > 90) return false;
  if (/\bsubject\s*:/.test(normalized)) return false;
  if (/^(dear|hi|hello|respected)\b/.test(normalized)) return false;
  if (/^(best regards|warm regards|kind regards|regards|sincerely|with gratitude|thank you|yours)/.test(normalized)) return false;
  if (!EMAIL_VARIANT_KEYWORDS_PATTERN.test(normalized)) return false;
  if (/[.!?]$/.test(normalized)) return false;
  return true;
}

function stripTrailingVariantHeader(segment: string): string {
    const lines = String(segment || '').split('\n');
    let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end -= 1;
  if (end < 0) return '';

    let start = end;
  while (start >= 0 && lines[start].trim()) start -= 1;
    const tail = lines.slice(start + 1, end + 1).map((line) => line.trim()).filter(Boolean);
    const isVariantTail = tail.length > 0 && tail.length <= 2 && tail.every((line) => isVariantHeaderLine(line));
  if (!isVariantTail) return segment.trim();
  return lines.slice(0, start + 1).join('\n').trim();
}

function splitEmailCandidates(raw: string): string[] {
    const text = String(raw || '').trim();
  if (!text) return [];
    const subjectStarts: number[] = [];
  for (const match of text.matchAll(EMAIL_SUBJECT_GLOBAL_PATTERN)) {
    if (typeof match.index === 'number') subjectStarts.push(match.index);
  }
  if (subjectStarts.length <= 1) return [text];

    const segments: string[] = [];
  for (let i = 0; i < subjectStarts.length; i += 1) {
        const start = subjectStarts[i];
        const end = i + 1 < subjectStarts.length ? subjectStarts[i + 1] : text.length;
        const segment = stripTrailingVariantHeader(text.slice(start, end));
    if (segment) segments.push(segment);
  }
  return segments.length ? segments : [text];
}

function parseEmailDrafts(text: string): ParsedEmailDraft[] {
    const raw = String(text || '').trim();
  if (!raw) return [];
    const candidates = splitEmailCandidates(raw);
    const parsed: ParsedEmailDraft[] = [];
  for (const candidate of candidates) {
        const draft = parseSingleEmailDraft(candidate);
    if (draft) parsed.push(draft);
  }
  if (parsed.length > 0) return parsed;
    const fallback = parseSingleEmailDraft(raw);
  return fallback ? [fallback] : [];
}

type EmailDraftBlockBuild = {
    blocks: StreamBlock[] | null;
    emailJsonParseOk: boolean;
    emailDraftCount: number;
    emailFallbackUsed: boolean;
};

function buildEmailDraftBlocks(reply: string): EmailDraftBlockBuild {
    const envelope = parseEmailEnvelope(reply);
  if (envelope) {
        const blocks: StreamBlock[] = [];
    envelope.drafts.forEach((draft, index) => {
      if (index === 0 && envelope.intro) {
        blocks.push({ type: 'markdown', text: envelope.intro });
      }
      blocks.push({ type: 'email_draft', subject: draft.subject, body: draft.bodyMarkdown, ...(draft.label ? { label: draft.label } : {}) });
      if (index === envelope.drafts.length - 1 && envelope.outro) {
        blocks.push({ type: 'markdown', text: envelope.outro });
      }
    });
    return {
      blocks,
      emailJsonParseOk: true,
      emailDraftCount: envelope.drafts.length,
      emailFallbackUsed: false,
    };
  }

    const drafts = parseEmailDrafts(reply);
  if (!drafts.length) {
    return {
      blocks: null,
      emailJsonParseOk: false,
      emailDraftCount: 0,
      emailFallbackUsed: false,
    };
  }

    const blocks: StreamBlock[] = [];
  drafts.forEach((draft, index) => {
    if (draft.intro) {
      blocks.push({ type: 'markdown', text: draft.intro });
    }
    blocks.push({ type: 'email_draft', subject: draft.subject, body: draft.body });
    if (draft.outro && index === drafts.length - 1) {
      blocks.push({ type: 'markdown', text: draft.outro });
    }
  });
  return {
    blocks,
    emailJsonParseOk: false,
    emailDraftCount: drafts.length,
    emailFallbackUsed: true,
  };
}

const EMAIL_MODE_PATTERNS = [
  /\b(draft|write|compose|generate|create)\s+(an?\s+)?(email|mail)\b/i,
  /\b(email|mail)\s+(draft|template|version|subject|body)\b/i,
  /\bsubject\s*[:\-]/i,
  /\b(resignation|birthday|apology|follow[-\s]?up|request|application)\s+email\b/i,
];

function shouldUseEmailDraftMode(message: string): boolean {
    const text = String(message || '').trim();
  if (!text) return false;
  return EMAIL_MODE_PATTERNS.some((pattern) => pattern.test(text));
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

function buildAttachmentContextBundle(
  attachments: AttachmentLike[],
    chunks: AttachmentChunkLike[] = [],
): { promptText: string; sourceBlock?: StreamBlock } {
  if (!attachments.length) return { promptText: '' };
    const lines: string[] = [];
    const metadata: string[] = [];
    const byAttachment = new Map<string, AttachmentChunkLike[]>();
  for (const c of chunks) {
        const arr = byAttachment.get(c.attachmentId) || [];
    arr.push(c);
    byAttachment.set(c.attachmentId, arr);
  }
    const remainingChars = { value: 18_000 };
  for (const att of attachments) {
        const sizeKb = Math.max(1, Math.round((att.sizeBytes || 0) / 1024));
        const structured = (att.structuredMetadata && typeof att.structuredMetadata === 'object')
      ? (att.structuredMetadata as Record<string, any>)
      : {};
        const quality = typeof structured.extractionQuality === 'string' ? structured.extractionQuality : null;
        const stats = (structured.extractionStats && typeof structured.extractionStats === 'object')
      ? (structured.extractionStats as Record<string, any>)
      : {};
    metadata.push(`${att.filename} (${att.mimeType}, ${sizeKb} KB, ${att.processingStatus}${quality ? `, ${quality}` : ''})`);
    lines.push(`File: ${att.filename}`);
    lines.push(`Type: ${att.mimeType}`);
    lines.push(`Status: ${att.processingStatus}`);
    if (quality) lines.push(`Extraction quality: ${quality}`);
    if (typeof stats.rowsParsed === 'number') {
      lines.push(`Rows parsed: ${stats.rowsParsed}`);
    } else if (typeof stats.rowsTotal === 'number') {
      lines.push(`Rows total: ${stats.rowsTotal}`);
    } else if (typeof stats.rowsSampled === 'number') {
      lines.push(`Rows sampled: ${stats.rowsSampled}`);
    }
    if (typeof stats.coverage === 'string') {
      lines.push(`Coverage: ${stats.coverage}`);
    }
        const extracted = (att.extractedText || '').trim();
    if (extracted && remainingChars.value > 200) {
            const payload = extracted.slice(0, Math.min(2200, remainingChars.value));
      lines.push(`Extracted text: ${payload}`);
      remainingChars.value -= payload.length;
    }
        const attachmentChunks = byAttachment.get(att.id) || [];
    if (attachmentChunks.length && remainingChars.value > 400) {
            const sourceRank: Record<string, number> = {
        sheet_text: 0,
        doc_text: 1,
        plain_text: 2,
        pdf_text: 3,
        mixed: 4,
        ocr: 5,
      };
            const ranked = [...attachmentChunks].sort((a, b) => {
                const aSrc = ((a.metadata as any)?.source || 'z') as string;
                const bSrc = ((b.metadata as any)?.source || 'z') as string;
                const ar = sourceRank[aSrc] ?? 99;
                const br = sourceRank[bSrc] ?? 99;
        if (ar !== br) return ar - br;
        return a.chunkIndex - b.chunkIndex;
      });
      for (const ch of ranked.slice(0, 6)) {
        if (remainingChars.value <= 300) break;
                const chunkText = ch.content.slice(0, Math.min(1800, remainingChars.value));
        lines.push(`Chunk ${ch.chunkIndex + 1}: ${chunkText}`);
        remainingChars.value -= chunkText.length;
      }
    }
        const preview = (att.previewData && typeof att.previewData === 'object') ? (att.previewData as Record<string, unknown>) : null;
        const summary = typeof preview?.summary === 'string' ? preview.summary : '';
    if (summary) lines.push(`Preview: ${summary}`);
    lines.push('---');
  }
  return {
    promptText: `Attached files context:\n${lines.join('\n')}`,
    sourceBlock: {
      type: 'source',
      origin: 'Processed Files',
      metadata,
    },
  };
}

// ─── Follow-up detection ───────────────────────────────────────────────────────

type FollowUpResult =
  | { detected: false }
  | { detected: true; action: 'retry'; workflowKey: string }
  | { detected: true; action: 'show_previous'; contextItem: any }
  | { detected: true; action: 'entity_search'; query: string; results: any[] };

type FollowUpRoute =
  | { kind: 'none' }
  | { kind: 'show_previous'; contextItem: any }
  | { kind: 'explicit_rerun'; workflowKey: string; autoSwitched?: boolean; contextWorkflow?: string }
  | { kind: 'followup_answer'; workflowKey: string; contextItem: any }
  | { kind: 'use_cached_choice'; workflowKey: string; contextItem: any };

const RETRY_PATTERNS = [
  /\b(run|do|execute|trigger)\s+(it|that|this)\s+(again|once more)/i,
  /\bretry\b/i,
  /\b(run|do)\s+again\b/i,
  /\bsame\s+(workflow|thing)\s+again\b/i,
  /\brepeat\s+(it|that|this|the)\b/i,
  /\bredo\b/i,
];

// Matches bare confirmations like "yes", "sure", "do it", "go ahead", "okay run it"
const CONFIRMATION_PATTERNS = [
  /^\s*(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please|please do|run it|go for it|proceed|continue)\s*[.!]?\s*$/i,
  /^\s*(yes|yeah|sure|ok|okay)\s+(check|run|do|go|fetch|scan|trigger|please|proceed|continue)/i,
];

const SHOW_PREVIOUS_PATTERNS = [
  /\b(show|display|give me|what was)\s+(the\s+)?(previous|last|prior)\s+(output|result|response|data)/i,
  /\bprevious\s+(output|result)/i,
  /\blast\s+(result|output|run)/i,
  /\bwhat\s+(happened|did it return|was the result|were the results)/i,
  /\bshow\s+(me\s+)?(the\s+)?results?\s+again/i,
];

const USE_CACHED_PATTERNS = [
  /^\s*(use old|use cached|use previous|use last|answer from previous|continue with previous)\s*$/i,
  /^\s*(old result|cached result|previous result|last result)\s*$/i,
];

const RERUN_NOW_PATTERNS = [
  /^\s*(rerun now|run now|refresh now|rescan now|retry now)\s*$/i,
  /^\s*(run|rerun|retry|refresh|rescan)\s+(it|that|portfolio|workflow)\s*(now|again)?\s*$/i,
];

const DATA_FETCH_PATTERNS = [
  /^\s*(fetch|get|pull|load)\s+(the\s+)?data\b/i,
  /^\s*(fetch|get|pull|load)\b.*\b(answer|respond|reply)\b/i,
  /^\s*(answer|respond|reply)\b.*\busing\b.*\b(data|result|workflow)\b/i,
];

const EXECUTION_COMMAND_PATTERNS = [
  /\b(run|execute|trigger|retry|rescan|refresh|rerun|re-run|refetch)\b/i,
];

function isExecutionCommand(message: string): boolean {
  return EXECUTION_COMMAND_PATTERNS.some((p) => p.test(message.trim()));
}

function isDataFetchCommand(message: string): boolean {
  return DATA_FETCH_PATTERNS.some((p) => p.test(message.trim()));
}

function isConfirmationLike(message: string): boolean {
  return CONFIRMATION_PATTERNS.some((p) => p.test(message.trim()));
}

function isLikelyFollowUpQuestion(message: string): boolean {
    const m = message.trim().toLowerCase();
  if (!m) return false;
  if (m.length <= 180) return true;
  return /^(what|how|which|who|where|when|why|can|do|does|did|list|tell|show)\b/.test(m);
}

async function resolveWorkflowKeyFromHint(hint: string): Promise<string | null> {
    const clean = String(hint || "").trim();
  if (!clean) return null;
    const normalized = clean.toLowerCase();
    const workflows = await WorkflowService.getAll({ archived: false, enabled: true });
    const exactKey = workflows.find((wf: any) => String(wf.key || "").toLowerCase() === normalized);
  if (exactKey?.key) return String(exactKey.key);
    const exactName = workflows.find((wf: any) => String(wf.name || "").toLowerCase() === normalized);
  if (exactName?.key) return String(exactName.key);

    const compact = normalized.replace(/[\s_\-]+/g, "");
    const fuzzy = workflows.find((wf: any) => {
        const keyCompact = String(wf.key || "").toLowerCase().replace(/[\s_\-]+/g, "");
        const nameCompact = String(wf.name || "").toLowerCase().replace(/[\s_\-]+/g, "");
    return keyCompact === compact || nameCompact === compact;
  });
  return fuzzy?.key ? String(fuzzy.key) : null;
}

function extractWorkflowHintFromAssistantText(text: string): string | null {
    const body = String(text || "")
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return null;

    const patterns = [
    /need to run\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /need\s+(?:data|details|info|information)\s+from\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /(?:run|execute|trigger)\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /workflow\s+["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+would need to run/i,
    /can\s+(?:run|execute|trigger)\s+(?:the\s+)?["']?([a-zA-Z0-9._\-\s]+?)["']?\s+workflow/i,
    /from\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
  ];
  for (const p of patterns) {
        const m = body.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function tokenizeForWorkflowMatch(input: string): string[] {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function workflowMatchScore(message: string, workflow: any): number {
    const text = String(message || "").toLowerCase();
    const key = String(workflow?.key || "").toLowerCase();
    const name = String(workflow?.name || "").toLowerCase();
    const description = String(workflow?.description || "").toLowerCase();
    const tags = Array.isArray(workflow?.tags) ? workflow.tags.map((t: any) => String(t).toLowerCase()) : [];

    let score = 0;
  if (key && text.includes(key)) score += 10;
  if (name && text.includes(name)) score += 10;
  for (const tag of tags) {
    if (tag && text.includes(tag)) score += 4;
  }

    const msgTokens = new Set(tokenizeForWorkflowMatch(text));
    const wfTokens = new Set([
    ...tokenizeForWorkflowMatch(key.replace(/[_\-]+/g, " ")),
    ...tokenizeForWorkflowMatch(name),
    ...tokenizeForWorkflowMatch(description).slice(0, 30),
    ...tags.flatMap((t: string) => tokenizeForWorkflowMatch(t)),
  ]);
  for (const token of wfTokens) {
    if (msgTokens.has(token)) score += 1;
  }
  return score;
}

async function inferWorkflowFromMessage(threadId: string, message: string): Promise<string | null> {
    const workflows = await WorkflowService.getAll({ archived: false, enabled: true } as any);
  if (!Array.isArray(workflows) || workflows.length === 0) return null;

    let best: { key: string; score: number } | null = null;
  for (const wf of workflows) {
        const key = String((wf as any)?.key || "");
    if (!key) continue;
        const score = workflowMatchScore(message, wf);
    if (!best || score > best.score) best = { key, score };
  }
  if (!best || best.score < 5) return null;

    const ctxItems = await ContextService.getThreadContext(threadId, { categories: ["workflow_run"], limit: 30 });
    const hasCtx = new Set(
    ctxItems
      .map((i: any) => String(((i?.metadata || {}) as Record<string, unknown>)?.workflowKey || ""))
      .filter(Boolean),
  );
  if (hasCtx.has(best.key)) return best.key;
  return best.key;
}

async function getPendingWorkflowFromRecentAssistantPrompt(threadId: string): Promise<string | null> {
    const messages = await ChatService.getMessages(threadId);
    const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
  if (!lastAssistant) return null;
    const content = String(lastAssistant.content || "");
    const rawBlocks = (lastAssistant as any)?.blocks;
    const blocks = Array.isArray(rawBlocks)
    ? rawBlocks
    : Array.isArray(rawBlocks?.blocks)
      ? rawBlocks.blocks
      : [];
    const questionPrompts = blocks
    .filter((b: any) => b?.type === "question_mcq")
    .map((b: any) => {
            const prompt = String(b?.prompt || "");
            const optText = Array.isArray(b?.options)
        ? b.options.map((o: any) => `${String(o?.label || "")} ${String(o?.description || "")}`).join(" ")
        : "";
      return `${prompt} ${optText}`.trim();
    })
    .filter(Boolean);
    const permissionText = [content, ...questionPrompts].join("\n");
    const hint = extractWorkflowHintFromAssistantText(permissionText);
  if (!hint) return null;

    const asksPermission = /\b(would you like me to|would you like to|do you want me to|do you want to|if you(?:\s*'|’)d like me to|if you would like me to|i(?:\s*'|’)d need to run|need to run|let me know if you(?:'|’)d like me to|should i proceed|can i run|can i fetch|you can fetch it by running|to .* run the|just say the word)\b/i.test(permissionText);
    const indicatesMissingEvidence = /\bINSUFFICIENT_EVIDENCE\b/i.test(permissionText);
  if (!asksPermission && !indicatesMissingEvidence) return null;

  return await resolveWorkflowKeyFromHint(hint);
}

function isLikelyQuestionWorthAnswering(message: string): boolean {
    const trimmed = message.trim();
  if (!trimmed) return false;
  if (isConfirmationLike(trimmed)) return false;
  if (RERUN_NOW_PATTERNS.some((p) => p.test(trimmed))) return false;
  if (USE_CACHED_PATTERNS.some((p) => p.test(trimmed))) return false;
  if (isExecutionCommand(trimmed) || isDataFetchCommand(trimmed)) return false;
  return trimmed.length >= 8;
}

async function resolveQuestionForRerun(threadId: string, currentMessage: string): Promise<string | null> {
  if (isLikelyQuestionWorthAnswering(currentMessage)) {
    return currentMessage.trim();
  }

    const messages = await ChatService.getMessages(threadId);
    const priorUser = [...messages]
    .reverse()
    .find((m: any) => m.role === "user" && isLikelyQuestionWorthAnswering(String(m.content || "")));

  return priorUser ? String(priorUser.content || "").trim() : null;
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

async function getPreferredWorkflowFromRecentAssistantSource(threadId: string): Promise<string | null> {
    const messages = await ChatService.getMessages(threadId);
    const latestAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
  if (!latestAssistant) return null;
    const rawBlocks = (latestAssistant as any)?.blocks;
    const blocks = Array.isArray(rawBlocks)
    ? rawBlocks
    : Array.isArray(rawBlocks?.blocks)
      ? rawBlocks.blocks
      : [];
  for (const b of blocks) {
    if (!b || b.type !== 'source') continue;
        const metadata = Array.isArray((b as any).metadata) ? (b as any).metadata as string[] : [];
        const workflowMeta = metadata.find((m) => /^workflow:\s*/i.test(String(m)));
    if (workflowMeta) {
            const value = String(workflowMeta).replace(/^workflow:\s*/i, '').trim();
      if (value) return value;
    }
  }
  return null;
}

/**
 * Detect follow-up patterns deterministically before calling the LLM.
 * Returns a typed result indicating whether a follow-up was detected and what action to take.
 */
async function detectFollowUp(threadId: string, message: string): Promise<FollowUpResult> {
  if (!contextConfig.enabled) return { detected: false };

    const msg = message.trim();

  // 1. Retry / run-again detection
  if (RETRY_PATTERNS.some(p => p.test(msg))) {
        const lastCtx = await ContextService.getLastWorkflowContext(threadId);
    if (lastCtx) {
            const meta = lastCtx.metadata as Record<string, unknown> | null;
            const workflowKey = meta?.workflowKey as string;
      if (workflowKey) {
        logger.info({ scope: 'orchestrator', message: `Follow-up detected: retry -> ${workflowKey}`, threadId, workflowKey });
        return { detected: true, action: 'retry', workflowKey };
      }
    }
  }

  // 1b. Confirmation detection: "yes" / "sure" / "do it" after a workflow suggestion
  if (CONFIRMATION_PATTERNS.some(p => p.test(msg))) {
    // Prefer a workflow explicitly suggested in the most recent assistant prompt.
    // This avoids reusing unrelated "last workflow context" during consent turns.
        const pendingWorkflowKey = await getPendingWorkflowFromRecentAssistantPrompt(threadId);
    if (pendingWorkflowKey) {
      logger.info({ scope: 'orchestrator', message: `Follow-up detected: confirmation prompt -> ${pendingWorkflowKey}`, threadId, workflowKey: pendingWorkflowKey });
      return { detected: true, action: 'retry', workflowKey: pendingWorkflowKey };
    }
  }

  if (isDataFetchCommand(msg)) {
        const pendingWorkflowKey = await getPendingWorkflowFromRecentAssistantPrompt(threadId);
    if (pendingWorkflowKey) {
      logger.info({ scope: 'orchestrator', message: `Follow-up detected: data-fetch -> ${pendingWorkflowKey}`, threadId, workflowKey: pendingWorkflowKey });
      return { detected: true, action: 'retry', workflowKey: pendingWorkflowKey };
    }
  }

  // 2. Show previous output
  if (SHOW_PREVIOUS_PATTERNS.some(p => p.test(msg))) {
        const lastCtx = await ContextService.getLastWorkflowContext(threadId);
    if (lastCtx) {
      logger.info({ scope: 'orchestrator', message: 'Follow-up detected: show_previous', threadId });
      return { detected: true, action: 'show_previous', contextItem: lastCtx };
    }
  }

  // 3. Entity-based follow-up: "what about the email", "tell me about the scores"
    const entityMatch = msg.match(/\b(?:what\s+(?:about|is|are|was|were)\s+(?:the|my)?\s*)(.+)/i)
    || msg.match(/\b(?:tell\s+me\s+(?:about|more\s+about)\s+(?:the|my)?\s*)(.+)/i)
    || msg.match(/\b(?:show\s+(?:me\s+)?(?:the|my)?\s*)(.+?)(?:\s+(?:from|in)\s+(?:the|that|last)\s+(?:result|output|workflow))?$/i);

  if (entityMatch) {
        const query = entityMatch[1].trim().replace(/[?.!]+$/, '');
    if (query.length >= 3 && query.length <= 100) {
            const results = await ContextService.searchContext(threadId, query, 3);
      if (results.length > 0) {
        logger.info({ scope: 'orchestrator', message: `Follow-up detected: entity_search "${query}" (${results.length})`, threadId });
        return { detected: true, action: 'entity_search', query, results };
      }
    }
  }

  return { detected: false };
}

async function classifyFollowUpRoute(threadId: string, message: string): Promise<FollowUpRoute> {
  if (!contextConfig.enabled) return { kind: 'none' };

    const msg = message.trim();
    const followUp = await detectFollowUp(threadId, msg);

  if (followUp.detected && followUp.action === 'show_previous') {
    return { kind: 'show_previous', contextItem: followUp.contextItem };
  }

  if (followUp.detected && followUp.action === 'retry') {
    return { kind: 'explicit_rerun', workflowKey: followUp.workflowKey };
  }

    const lastCtx = await ContextService.getLastWorkflowContext(threadId);
  if (!lastCtx) return { kind: 'none' };
    const meta = (lastCtx.metadata || {}) as Record<string, unknown>;
    const workflowKeyFromLastContext = String(meta.workflowKey || '');
    const workflowKeyFromAssistantSource = await getPreferredWorkflowFromRecentAssistantSource(threadId);
    const workflowKey = workflowKeyFromAssistantSource || workflowKeyFromLastContext;
  if (!workflowKey) return { kind: 'none' };

    let routeContextItem: any = lastCtx;
  if (workflowKeyFromAssistantSource && workflowKeyFromAssistantSource !== workflowKeyFromLastContext) {
        const window = await ContextService.getThreadContext(threadId, { categories: ['workflow_run'], limit: 12 });
        const preferredItem = window.find((it: any) => {
            const key = String((((it?.metadata || {}) as Record<string, unknown>).workflowKey) || '');
      return key === workflowKeyFromAssistantSource;
    });
    if (preferredItem) routeContextItem = preferredItem;
  }

  if (!isExecutionCommand(msg) && isLikelyFollowUpQuestion(msg)) {
        const inferredWorkflowKey = await inferWorkflowFromMessage(threadId, msg);
    if (inferredWorkflowKey && inferredWorkflowKey !== workflowKey) {
      logger.info({ scope: 'orchestrator', message: `Cross-workflow auto-switch: ${workflowKey} -> ${inferredWorkflowKey}`, threadId, workflowKey: inferredWorkflowKey });
      return {
        kind: 'explicit_rerun',
        workflowKey: inferredWorkflowKey,
        autoSwitched: true,
        contextWorkflow: workflowKey,
      };
    }
  }

  if (RERUN_NOW_PATTERNS.some((p) => p.test(msg))) {
    return { kind: 'explicit_rerun', workflowKey };
  }
  if (USE_CACHED_PATTERNS.some((p) => p.test(msg))) {
    return { kind: 'use_cached_choice', workflowKey, contextItem: routeContextItem };
  }

  if (!isExecutionCommand(msg) && isLikelyFollowUpQuestion(msg)) {
    return { kind: 'followup_answer', workflowKey, contextItem: routeContextItem };
  }

  return { kind: 'none' };
}

async function getThreadWorkflowContextWindow(threadId: string, limit = 6): Promise<any[]> {
  try {
        const items = await ContextService.getThreadContext(threadId, {
      categories: ['workflow_run'],
      limit,
    });
    return (items || []).filter((it: any) => it?.category === 'workflow_run');
  } catch {
    return [];
  }
}

function scoreWorkflowContextItem(question: string, item: any): number {
    const q = String(question || '').toLowerCase();
    const meta = (item?.metadata || {}) as Record<string, unknown>;
    const workflowKey = String(meta.workflowKey || '').toLowerCase();
    const workflowName = String(meta.workflowName || '').toLowerCase();
    const content = String(item?.content || '').toLowerCase();

    let score = 0;
  if (workflowKey && q.includes(workflowKey)) score += 10;
  if (workflowName && q.includes(workflowName)) score += 10;

    const qTokens = new Set(tokenizeForWorkflowMatch(q));
    const wfTokens = new Set([
    ...tokenizeForWorkflowMatch(workflowKey.replace(/[_\-]+/g, ' ')),
    ...tokenizeForWorkflowMatch(workflowName),
  ]);
  for (const t of wfTokens) {
    if (qTokens.has(t)) score += 2;
  }

  // Prefer contexts whose content shares user tokens.
    let overlap = 0;
  for (const t of qTokens) {
    if (t.length < 4) continue;
    if (content.includes(t)) overlap += 1;
  }
  score += Math.min(6, overlap);

  // Freshness bonus.
    const createdAtMs = item?.createdAt ? new Date(item.createdAt).getTime() : 0;
  if (createdAtMs > 0) {
        const ageMins = (Date.now() - createdAtMs) / 60000;
    if (ageMins <= 15) score += 4;
    else if (ageMins <= 60) score += 2;
    else if (ageMins <= 240) score += 1;
  }
  return score;
}

function selectThreadWorkflowWindowForQuestion(
  question: string,
  items: any[],
  options?: { maxItems?: number; maxDistinctWorkflows?: number; preferredWorkflowKey?: string },
): any[] {
    const maxItems = options?.maxItems ?? 4;
    const maxDistinct = options?.maxDistinctWorkflows ?? 3;
    const preferred = String(options?.preferredWorkflowKey || '');
  if (!items.length) return [];

    const scored = [...items]
    .map((item) => ({ item, score: scoreWorkflowContextItem(question, item) }))
    .sort((a, b) => b.score - a.score);

    const picked: any[] = [];
    const byWorkflow = new Set<string>();

  // Prefer explicit workflow from route first when present.
  if (preferred) {
        const preferredItem = scored.find(({ item }) => {
            const key = String(((item?.metadata || {}) as Record<string, unknown>).workflowKey || '');
      return key === preferred;
    });
    if (preferredItem) {
      picked.push(preferredItem.item);
      byWorkflow.add(preferred);
    }
  }

  for (const { item } of scored) {
    if (picked.length >= maxItems) break;
        const key = String((((item?.metadata || {}) as Record<string, unknown>).workflowKey) || '');
        const isNewWorkflow = key && !byWorkflow.has(key);
    if (isNewWorkflow && byWorkflow.size >= maxDistinct) continue;
    if (!picked.includes(item)) picked.push(item);
    if (key) byWorkflow.add(key);
  }

  return picked.slice(0, maxItems);
}

function isDetailHeavyFollowUpQuestion(question: string): boolean {
    const q = String(question || '').toLowerCase();
  if (!q) return false;
  if (/(which|where|who|company|email|location|exact|details?|list|all|history|experience)/.test(q)) return true;
  if (/(count|sum|average|avg|min|max|greater than|less than|between|filter)/.test(q)) return true;
  return q.length > 110;
}

function inferRequestedFieldHints(question: string): string[] {
    const q = String(question || '').toLowerCase();
    const fields = new Set<string>();
    const fieldMatchers: Array<[string, RegExp]> = [
    ['name', /\bname\b/],
    ['email', /\bemail\b/],
    ['location', /\blocation|where\b/],
    ['phone', /\bphone|mobile|contact\b/],
    ['education', /\beducation|degree|college|university|graduation|gpa\b/],
    ['graduation', /\bgraduation|graduate|passed out\b/],
    ['experience', /\bexperience|work|job|employment\b/],
    ['company', /\bcompany|organization|worked at\b/],
    ['role', /\brole|position|title\b/],
    ['duration', /\bduration|tenure|how long\b/],
    ['description', /\bdescription|responsibilit|about\b/],
    ['project', /\bproject\b/],
    ['skills', /\bskills|tech stack|technologies\b/],
    ['linkedin', /\blinkedin\b/],
    ['github', /\bgithub\b/],
    ['portfolio', /\bportfolio\b/],
  ];
  for (const [field, pattern] of fieldMatchers) {
    if (pattern.test(q)) fields.add(field);
  }
  return [...fields].slice(0, 8);
}

function collectWorkflowKeys(items: any[]): string[] {
    const set = new Set<string>();
  for (const item of items) {
        const key = String((((item?.metadata || {}) as Record<string, unknown>).workflowKey) || '').trim();
    if (key) set.add(key);
  }
  return [...set];
}

function isInsufficientEvidenceText(text: string): boolean {
    const t = String(text || '').trim().toLowerCase();
  if (!t) return true;
  return t.startsWith('insufficient_evidence');
}

async function buildThreadEvidencePlan(input: {
    threadId: string;
    question: string;
  preferredWorkflowKey?: string;
  fallbackContextItem?: any;
}): Promise<{
    passA: { items: any[]; cacheData: string; workflowsUsed: string[] };
    passB: { items: any[]; cacheData: string; workflowsUsed: string[] };
    telemetry: { relevantRuns: number; requestedFields: string[]; usedFieldExtraction: boolean };
}> {
    const detailHeavy = isDetailHeavyFollowUpQuestion(input.question);
    const preferred = String(input.preferredWorkflowKey || '');
    const requestedFields = inferRequestedFieldHints(input.question);
    const relevantMatches = await ContextService.findRelevantWorkflowRuns(input.threadId, input.question, {
    limit: detailHeavy ? 10 : 6,
    preferredWorkflowKey: preferred || undefined,
  });
    const rankedItems = relevantMatches.map((match) => match.item);

    const rawA = rankedItems.length ? rankedItems : await getThreadWorkflowContextWindow(input.threadId, detailHeavy ? 10 : 8);
    const selectedA = selectThreadWorkflowWindowForQuestion(input.question, rawA, {
    maxItems: detailHeavy ? 6 : 4,
    maxDistinctWorkflows: detailHeavy ? 4 : 3,
    preferredWorkflowKey: preferred,
  });
    const passAItems = selectedA.length ? selectedA : (input.fallbackContextItem ? [input.fallbackContextItem] : rawA.slice(0, 1));

    const rawB = rankedItems.length ? rankedItems : await getThreadWorkflowContextWindow(input.threadId, detailHeavy ? 20 : 16);
    const selectedB = selectThreadWorkflowWindowForQuestion(input.question, rawB, {
    maxItems: detailHeavy ? 10 : 8,
    maxDistinctWorkflows: detailHeavy ? 6 : 5,
    preferredWorkflowKey: preferred,
  });
    const passBItems = selectedB.length ? selectedB : passAItems;

    const extractionLinesA = requestedFields.length
    ? await Promise.all(
        passAItems.slice(0, 2).map(async (item) => {
                    const meta = (item?.metadata || {}) as Record<string, unknown>;
                    const extracted = await ContextService.extractWorkflowRunFields(item, requestedFields);
                    const entries = Object.entries(extracted.values);
          if (!entries.length) return '';
          return [
            `Exact fields from ${String(meta.workflowName || meta.workflowKey || 'workflow')}:`,
            ...entries.map(([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`),
          ].join('\n');
        }),
      )
    : [];

    const extractionLinesB = requestedFields.length
    ? await Promise.all(
        passBItems.slice(0, 3).map(async (item) => {
                    const meta = (item?.metadata || {}) as Record<string, unknown>;
                    const extracted = await ContextService.extractWorkflowRunFields(item, requestedFields);
                    const entries = Object.entries(extracted.values);
          if (!entries.length) return '';
          return [
            `Exact fields from ${String(meta.workflowName || meta.workflowKey || 'workflow')}:`,
            ...entries.map(([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`),
          ].join('\n');
        }),
      )
    : [];

    const passAEvidence = await Promise.all(
    passAItems.map(async (item) => ({
      item,
      cacheText: await ContextService.loadCompleteWorkflowCache(item),
    })),
  );
    const passBEvidence = await Promise.all(
    passBItems.map(async (item) => ({
      item,
      cacheText: await ContextService.loadCompleteWorkflowCache(item),
    })),
  );

  return {
    passA: {
      items: passAItems,
      cacheData: [
        ...extractionLinesA.filter(Boolean),
        buildThreadWorkflowCacheData(passAEvidence, { maxTotalTokens: detailHeavy ? 36_000 : 24_000 }),
      ].filter(Boolean).join('\n\n'),
      workflowsUsed: collectWorkflowKeys(passAItems),
    },
    passB: {
      items: passBItems,
      cacheData: [
        ...extractionLinesB.filter(Boolean),
        buildThreadWorkflowCacheData(passBEvidence, { maxTotalTokens: contextConfig.cacheDataBudgetTokens }),
      ].filter(Boolean).join('\n\n'),
      workflowsUsed: collectWorkflowKeys(passBItems),
    },
    telemetry: {
      relevantRuns: relevantMatches.length,
      requestedFields,
      usedFieldExtraction: extractionLinesA.some(Boolean) || extractionLinesB.some(Boolean),
    },
  };
}

function buildThreadWorkflowCacheData(
    evidenceItems: Array<{ item: any; cacheText: string }>,
  options?: { maxTotalTokens?: number },
): string {
  if (!evidenceItems.length) return '';
    const maxTotalTokens = Math.max(2_000, options?.maxTotalTokens ?? contextConfig.cacheDataBudgetTokens);
    const parts: string[] = [];
    let usedTokens = 0;

  for (const entry of evidenceItems) {
        const item = entry.item;
        const meta = (item?.metadata || {}) as Record<string, unknown>;
        const workflowName = String(meta.workflowName || meta.workflowKey || 'workflow');
        const workflowKey = String(meta.workflowKey || '');
        const createdAt = item?.createdAt ? new Date(item.createdAt).toISOString() : '';
        const fullEntry = [
      `Workflow: ${workflowName}${workflowKey ? ` (${workflowKey})` : ''}`,
      createdAt ? `CapturedAt: ${createdAt}` : '',
      'Result:',
      String(entry.cacheText || item?.content || ''),
    ]
      .filter(Boolean)
      .join('\n');
        const entryTokens = estimateTokens(fullEntry);

    if (usedTokens === 0 && entryTokens > maxTotalTokens) {
      return truncateToTokenBudget(fullEntry, maxTotalTokens);
    }
    if (usedTokens + entryTokens > maxTotalTokens) {
      continue;
    }
    parts.push(fullEntry);
    usedTokens += entryTokens;
  }
  return truncateToTokenBudget(parts.join('\n\n---\n\n'), maxTotalTokens);
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

function buildStaleChoicePrompt(workflowName: string, ageMins: number): string {
  return `I found a previous **${workflowName}** result from about ${ageMins} minute(s) ago. Do you want me to:\n\n1. **use old** — answer from that result\n2. **rerun now** — trigger a fresh workflow run`;
}

function makeQuestionId(prefix = 'q'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stripInlineMarkdown(input: string): string {
  return input
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/^\s*[-*]\s*/, '')
    .trim();
}

function isActionableQuestionPrompt(prompt: string): boolean {
    const raw = String(prompt || '').trim().toLowerCase();
  if (!raw) return false;
  return /\b(choose|select|continue|proceed|which option|what do you want|would you like|do you want|should i|can i|may i)\b/.test(raw);
}

function isActionableQuestionOption(label: string): boolean {
    const raw = String(label || '').trim().toLowerCase();
  if (!raw) return false;
  return /\b(yes|no|proceed|continue|not now|cancel|stop|retry|rerun|run now|use old|use cached|approve|reject|fetch|run)\b/.test(raw);
}

function buildStaleChoiceQuestionBlock(workflowName: string, ageMins: number): StreamBlock {
  return {
    type: 'question_mcq',
    questionId: makeQuestionId('stale'),
    prompt: `I found a previous ${workflowName} result from about ${ageMins} minute(s) ago. Choose how you want to continue:`,
    options: [
      {
        id: 'use_old',
        label: 'Use old result',
        valueToSend: 'use old',
        description: 'Answer from the existing result without rerunning.',
        recommended: true,
      },
      {
        id: 'rerun_now',
        label: 'Rerun now',
        valueToSend: 'rerun now',
        description: 'Trigger a fresh workflow run before answering.',
      },
    ],
    allowFreeText: false,
  };
}

function parseQuestionMcqFromText(text: string): StreamBlock | null {
    const raw = (text || '').trim();
  if (!raw) return null;

    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const options: Array<{ id: string; label: string; valueToSend: string; description?: string }> = [];
    let firstOptionLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(\d+)[\).\:-]\s*(.+)$/);
    if (!match) continue;
    if (firstOptionLineIdx === -1) firstOptionLineIdx = i;
        const idx = Number(match[1]);
        const body = stripInlineMarkdown(match[2]);
    if (!body) continue;
    const [left, right] = body.split(/\s+—\s+|\s+-\s+/, 2);
        const label = stripInlineMarkdown(left || body);
        const valueLower = label.toLowerCase();
        let valueToSend = label;
    if (valueLower.includes('use old')) valueToSend = 'use old';
    else if (valueLower.includes('rerun') || valueLower.includes('retry') || valueLower.includes('run again')) valueToSend = 'rerun now';
    options.push({
      id: `opt_${idx}`,
      label,
      valueToSend,
      description: right ? stripInlineMarkdown(right) : undefined,
    });
  }

  if (options.length < 2 || firstOptionLineIdx === -1) return null;

    const promptLines = lines.slice(0, firstOptionLineIdx);
    const prompt = stripInlineMarkdown(promptLines.join(' '));
  if (!prompt) return null;
    const hasActionableOptions = options.some((opt) => isActionableQuestionOption(opt.label));
  if (!hasActionableOptions && !isActionableQuestionPrompt(prompt)) return null;

  return {
    type: 'question_mcq',
    questionId: makeQuestionId('mcq'),
    prompt,
    options,
    allowFreeText: false,
  };
}

function parseProceedQuestionFromText(text: string): StreamBlock | null {
    const raw = (text || '').trim();
  if (!raw) return null;
    const normalized = raw.replace(/\s+/g, ' ');
    const asksForChoice =
    /\b(would you like|do you want|should i|can i|could i|shall i|let me know if you(?:'|’)d like)\b/i.test(normalized);
    const executionVerb =
    /\b(run|execute|trigger|rerun|retry|refresh|rescan|scan|fetch|start|launch|proceed)\b/i.test(normalized);
    const executionTarget =
    /\b(workflow|action|automation|task|run)\b/i.test(normalized);
    const nonExecutionHelp =
    /\b(format|rephrase|rewrite|shorten|length|tone|style|anything else|help with anything else|wording)\b/i.test(normalized);

    const asksToProceed = asksForChoice && executionVerb && (executionTarget || /\b(run|execute|trigger|rerun|retry|fetch)\b/i.test(normalized));
  if (nonExecutionHelp && !executionTarget) return null;
  if (!asksToProceed) return null;

    const workflowHint = extractWorkflowHintFromAssistantText(raw);
    const prompt = workflowHint
    ? `I can run the ${workflowHint} workflow now. Choose how you want to continue:`
    : 'I can proceed with the requested workflow action. Choose how you want to continue:';

  return {
    type: 'question_mcq',
    questionId: makeQuestionId('proceed'),
    prompt,
    options: [
      {
        id: 'proceed_approve',
        label: 'Approve and run',
        valueToSend: 'yes proceed',
        description: 'Run the workflow now.',
        recommended: true,
      },
      {
        id: 'proceed_no',
        label: 'Not now',
        valueToSend: 'no',
        description: 'Keep current context without running.',
      },
    ],
    allowFreeText: false,
  };
}

function buildQuestionFromText(text: string): StreamBlock | null {
  return parseQuestionMcqFromText(text) || parseProceedQuestionFromText(text);
}

function shouldForceInteractiveQuestion(text: string): boolean {
  if (!isInteractiveQuestionEnforced()) return false;
    const raw = String(text || "").trim();
  if (!raw) return false;
    const asksForChoice =
    /\b(would you like|do you want|should i|can i|could i|shall i|let me know if you(?:'|’)d like)\b/i.test(raw);
    const executionVerb =
    /\b(run|execute|trigger|rerun|retry|refresh|rescan|scan|fetch|start|launch|proceed)\b/i.test(raw);
    const executionTarget =
    /\b(workflow|action|automation|task|run)\b/i.test(raw);
    const nonExecutionHelp =
    /\b(format|rephrase|rewrite|shorten|length|tone|style|anything else|help with anything else|wording)\b/i.test(raw);
  if (nonExecutionHelp && !executionTarget) return false;
  return asksForChoice && executionVerb && (executionTarget || /\b(run|execute|trigger|rerun|retry|fetch)\b/i.test(raw));
}

function buildForcedProceedQuestion(text: string): StreamBlock {
    const hint = extractWorkflowHintFromAssistantText(text);
  return {
    type: 'question_mcq',
    questionId: makeQuestionId('forced'),
    prompt: hint
      ? `I can run the ${hint} workflow now. Choose how you want to continue:`
      : 'Choose how you want to continue:',
    options: [
      {
        id: 'forced_approve',
        label: 'Approve and run',
        valueToSend: 'yes proceed',
        description: 'Run the workflow now.',
        recommended: true,
      },
      {
        id: 'forced_no',
        label: 'Not now',
        valueToSend: 'no',
        description: 'Keep current context without running.',
      },
    ],
    allowFreeText: false,
  };
}

function buildTemporalSourceMetadata(answer: {
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

async function generateCachedContextAnswer(input: {
    question: string;
    cacheData: string;
    workflowName: string;
  providerId?: string;
  model?: string;
  history?: ConversationMessage[];
  context?: RetrievedContext;
  attachmentContext?: string;
  routingHint?: "default" | "reasoning_heavy";
}): Promise<string> {
    const prompt =
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
        const threadContext = await ContextService.getThreadContext(threadId, {
      categories: ['thread_state', 'workflow_run'],
      limit: retrievalLimit,
    });
        const contextPromptSection = ContextService.formatForPrompt(threadContext, {
      maxTotalTokens: contextConfig.retrievedContextBudgetTokens,
      maxTokensPerItem: contextConfig.maxContextItemTokens,
      maxDecisionItems: 6,
    });
        const retrievedContext: RetrievedContext | undefined = contextPromptSection
      ? { formatted: contextPromptSection }
      : undefined;

        const attachmentChunks = effectiveAttachments.length
      ? await ChatRepo.getAttachmentChunksByAttachmentIds(effectiveAttachments.map((a) => a.id), { limitPerAttachment: 8 })
      : [];
        const attachmentBundle = buildAttachmentContextBundle(effectiveAttachments, attachmentChunks as any);
        const contentWithAttachments = attachmentBundle.promptText
      ? `${content}\n\n${attachmentBundle.promptText}`
      : content;
        const strictGroundedAttachmentTurn = effectiveAttachments.length > 0;
        const hasEvidence = hasUsableAttachmentEvidence(effectiveAttachments, attachmentChunks as any);

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

      return await ChatService.addMessage(threadId, 'assistant', grounded, {
        blocks: [
          { type: 'summary', items: ['Answered from thread context window (no rerun).'] },
          { type: 'markdown', text: grounded },
          ...(parsedQuestion ? [parsedQuestion] : []),
          {
            type: 'source',
            origin: 'Follow-up Context — thread',
            metadata: [
              ...(parsedQuestion ? ['answerMode: interactive_question', `questionId: ${parsedQuestion.questionId}`] : []),
              'answerMode: context_followup',
              `routeKind: ${route.kind}`,
              `workflow: ${effectiveWorkflowKey}`,
              `contextScope: thread_window`,
              `contextsUsed: ${contextsUsed || 1}`,
              `workflowsUsed: ${workflowsUsed.join('|') || effectiveWorkflowKey}`,
              `contextPass: ${contextPass}`,
              `evidenceExpanded: ${evidenceExpanded ? 'true' : 'false'}`,
              'modelTier: preferred_reasoning',
              `dataAgeSeconds: ${Math.round(ageMs / 1000)}`,
              'rerunPromptPending: false',
              ...buildReActTelemetryMetadata(followupTelemetry),
            ],
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
        });
        if (isInsufficientEvidenceText(rerunAnswer)) rerunAnswer = '';
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
          ? `Based on the recent **${cacheResult.workflowName}** run (${cacheResult.ageSeconds}s ago):\n\n${truncateToTokenBudget(cacheResult.cachedData, 8_000)}${attachmentBundle.promptText ? `\n\n${attachmentBundle.promptText}` : ''}`
          : groundedCachedAnswer;
                const parsedQuestion = buildQuestionFromText(cachedAnswer) || (shouldForceInteractiveQuestion(cachedAnswer) ? buildForcedProceedQuestion(cachedAnswer) : null);
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
        return await ChatService.addMessage(threadId, 'assistant', cachedAnswer, {
          blocks: [
            { type: 'summary', items: [`Main agent selected subagent **${workflow.name}** from workflow registry.`] },
            planBlock,
            { type: 'markdown', text: cachedAnswer },
            ...(parsedQuestion ? [parsedQuestion] : []),
            { type: 'source', origin: `Cached — ${cacheResult.workflowName}`, metadata: [...(parsedQuestion ? ['answerMode: interactive_question', `questionId: ${parsedQuestion.questionId}`] : []), `From cached run (${cacheResult.ageSeconds}s ago)`, `Workflow: ${workflow.key}`, ...buildReActTelemetryMetadata(cacheTelemetry)] },
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
            const planBlock = buildAgentPlanDetailBlock(executionDecision);
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
            const resultItems = formatRunResult(run);
            const summaryText = run.status === 'completed'
        ? `Main agent triggered **${workflow.name}** successfully.`
        : `Main agent triggered **${workflow.name}** with status: ${run.status}.`;
            const executionTelemetry = {
        source: 'orchestrator' as const,
        answerMode: answerFromRun && !isInsufficientEvidenceText(answerFromRun) ? 'workflow_execution_answer' : 'workflow_execution',
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
          ...(answerFromRun && !isInsufficientEvidenceText(answerFromRun) ? [{ type: 'markdown', text: answerFromRun }] : []),
          { type: run.status === 'failed' ? 'error' : 'result', title: run.status === 'failed' ? 'Execution Failed' : 'Results', items: resultItems, message: resultItems.join(' • ') },
          ...(attachmentBundle.sourceBlock ? [attachmentBundle.sourceBlock] : []),
          {
            type: 'source',
            origin: `${workflow.provider.charAt(0).toUpperCase() + workflow.provider.slice(1)} Workflow Engine`,
            metadata: [
              `Workflow: ${workflow.key}`,
              `Run: ${run.id}`,
              `Provider: ${workflow.provider}`,
              `answerMode: ${answerFromRun && !isInsufficientEvidenceText(answerFromRun) ? 'workflow_execution_answer' : 'workflow_execution'}`,
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
            conversationContext: contextPromptSection || '',
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
            const parsedQuestion = buildQuestionFromText(reply) || (shouldForceInteractiveQuestion(reply) ? buildForcedProceedQuestion(reply) : null);
            const emailBuild = buildEmailDraftBlocks(reply);
      if (emailModeUsed && !emailBuild.emailJsonParseOk) {
        logger.warn({
          scope: 'orchestrator',
          message: 'email_draft_v1 JSON parse failed, fallback parser used',
          threadId,
          traceId,
          preview: String(reply || '').slice(0, 160),
        });
      }
      return await ChatService.addMessage(threadId, 'assistant', reply, {
        blocks: [
          { type: 'summary', items: ['Main agent handled this as a direct chat response (no subagent execution).'] },
          buildAgentPlanDetailBlock(agentDecision),
          ...(emailBuild.blocks ?? [{ type: 'markdown', text: reply }]),
          ...(parsedQuestion ? [parsedQuestion] : []),
          ...(emailModeUsed ? [{
            type: 'source',
            origin: 'Email Draft Mode',
            metadata: [
              'emailModeUsed: true',
              `emailJsonParseOk: ${emailBuild.emailJsonParseOk ? 'true' : 'false'}`,
              `emailDraftCount: ${emailBuild.emailDraftCount}`,
              `emailFallbackUsed: ${emailBuild.emailFallbackUsed ? 'true' : 'false'}`,
            ],
          }] : []),
          ...(parsedQuestion ? [{
            type: 'source',
            origin: 'Interactive Question',
            metadata: [
              'answerMode: interactive_question',
              `questionId: ${parsedQuestion.questionId}`,
            ],
          }] : []),
          ...(attachmentBundle.sourceBlock ? [attachmentBundle.sourceBlock] : []),
        ],
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
        const threadContext = await ContextService.getThreadContext(threadId, {
      categories: ['thread_state', 'workflow_run'],
      limit: retrievalLimit,
    });
        const contextPromptSection = ContextService.formatForPrompt(threadContext, {
      maxTotalTokens: contextConfig.retrievedContextBudgetTokens,
      maxTokensPerItem: contextConfig.maxContextItemTokens,
      maxDecisionItems: 6,
    });

    // ── Build conversation history + retrieved context for LLM ──
        const history = await OrchestratorService.buildConversationHistory(threadId, model);
        const retrievedContext: RetrievedContext | undefined = contextPromptSection
      ? { formatted: contextPromptSection }
      : undefined;

        const attachmentChunks = effectiveAttachments.length
      ? await ChatRepo.getAttachmentChunksByAttachmentIds(effectiveAttachments.map((a) => a.id), { limitPerAttachment: 8 })
      : [];
        const attachmentBundle = buildAttachmentContextBundle(effectiveAttachments, attachmentChunks as any);
        const contentWithAttachments = attachmentBundle.promptText
      ? `${content}\n\n${attachmentBundle.promptText}`
      : content;
        const strictGroundedAttachmentTurn = effectiveAttachments.length > 0;
        const hasEvidence = hasUsableAttachmentEvidence(effectiveAttachments, attachmentChunks as any);

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
          metadata: [
            'emailModeUsed: true',
            `emailJsonParseOk: ${emailBuild.emailJsonParseOk ? 'true' : 'false'}`,
            `emailDraftCount: ${emailBuild.emailDraftCount}`,
            `emailFallbackUsed: ${emailBuild.emailFallbackUsed ? 'true' : 'false'}`,
          ],
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
          metadata: [
            ...(questionBlock ? ['answerMode: interactive_question', `questionId: ${questionBlock.questionId}`] : []),
            'answerMode: context_followup',
            `routeKind: ${route.kind}`,
            `workflow: ${workflowKey}`,
            `contextScope: thread_window`,
            `contextsUsed: ${followupMeta?.contextsUsed || 1}`,
            `workflowsUsed: ${(followupMeta?.workflowsUsed || [workflowKey]).join('|')}`,
            `contextPass: ${followupMeta?.contextPass || 'A'}`,
            `evidenceExpanded: ${followupMeta?.evidenceExpanded ? 'true' : 'false'}`,
            'modelTier: preferred_reasoning',
            `dataAgeSeconds: ${followupMeta?.dataAgeSeconds ?? 0}`,
            `rerunPromptPending: ${stalePromptPending ? 'true' : 'false'}`,
          ],
        };
        callbacks.onBlock(blockIndex++, followupSource);
        blocks.push(followupSource);
      } else if (questionBlock) {
                const questionSource: StreamBlock = {
          type: 'source',
          origin: 'Interactive Question',
          metadata: [
            'answerMode: interactive_question',
            `questionId: ${questionBlock.questionId}`,
          ],
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
