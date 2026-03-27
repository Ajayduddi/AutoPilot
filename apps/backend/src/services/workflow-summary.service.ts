import { LLMFactory } from '../providers/llm/llm.factory';

const MAX_JSON_PREVIEW = 6000;
const AI_TIMEOUT_MS = 7000;

export interface CallbackSummaryInput {
  workflowKey: string;
  provider: string;
  status: 'completed' | 'failed';
  runId: string;
  traceId: string;
  result?: unknown;
  raw?: unknown;
  error?: unknown;
}

export interface WorkflowNotificationSummary {
  kind: 'autonomous_workflow_result';
  summary: string;
  bullets: string[];
  rawPreview: string;
  suggestedQuestions: string[];
  workflowKey: string;
  provider: string;
  status: 'completed' | 'failed';
  runId: string;
  traceId: string;
  generatedBy: 'ai' | 'fallback';
}

function stringifySafe(value: unknown, max = MAX_JSON_PREVIEW): string {
  if (value === undefined || value === null) return 'null';
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (str.length <= max) return str;
    return `${str.slice(0, max)}\n... (truncated)`;
  } catch {
    const fallback = String(value);
    return fallback.length <= max ? fallback : `${fallback.slice(0, max)}\n... (truncated)`;
  }
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function makeFallback(input: CallbackSummaryInput, rawPreview: string): WorkflowNotificationSummary {
  const statusText = input.status === 'completed' ? 'completed successfully' : 'failed';
  const summary = input.status === 'completed'
    ? `Autonomous workflow '${input.workflowKey}' completed. Review the key output and follow up in chat for deeper analysis.`
    : `Autonomous workflow '${input.workflowKey}' failed. Review the error details and follow up in chat for debugging help.`;

  const topLine = firstNonEmpty(
    typeof input.error === 'string' ? input.error : '',
    typeof input.result === 'string' ? input.result : '',
  );

  const bullets = [
    `Run ${input.runId.slice(0, 10)}… ${statusText}.`,
    `Provider: ${input.provider}.`,
    topLine ? `Top signal: ${topLine.slice(0, 160)}${topLine.length > 160 ? '…' : ''}` : `Trace: ${input.traceId}.`,
  ];

  return {
    kind: 'autonomous_workflow_result',
    summary,
    bullets,
    rawPreview,
    suggestedQuestions: [
      'What are the most important outcomes?',
      'Any anomalies I should investigate?',
      'What should I do next based on this result?',
    ],
    workflowKey: input.workflowKey,
    provider: input.provider,
    status: input.status,
    runId: input.runId,
    traceId: input.traceId,
    generatedBy: 'fallback',
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const jsonCandidate = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  try {
    const parsed = JSON.parse(jsonCandidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeStringList(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, limit);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Summary generation timeout')), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export class WorkflowSummaryService {
  static async summarizeCallback(input: CallbackSummaryInput): Promise<WorkflowNotificationSummary> {
    const rawPreview = stringifySafe(input.raw ?? input.result ?? input.error ?? null);
    const fallback = makeFallback(input, rawPreview);

    try {
      const provider = await LLMFactory.getDefaultProvider();
      const prompt = [
        'You summarize autonomous workflow callback payloads for an operations dashboard.',
        'Return VALID JSON only with this exact shape:',
        '{"summary":"...","bullets":["..."],"suggestedQuestions":["..."]}',
        'Rules:',
        '- summary: 1 to 2 sentences, direct and actionable, max 260 chars',
        '- bullets: 2 to 4 concise points',
        '- suggestedQuestions: exactly 3 follow-up questions a user can ask in chat',
        '- Do not use markdown.',
        '',
        `Workflow key: ${input.workflowKey}`,
        `Provider: ${input.provider}`,
        `Status: ${input.status}`,
        `Run ID: ${input.runId}`,
        `Trace ID: ${input.traceId}`,
        '',
        'Result JSON:',
        stringifySafe(input.result ?? null, MAX_JSON_PREVIEW),
        '',
        'Raw JSON:',
        stringifySafe(input.raw ?? null, MAX_JSON_PREVIEW),
        '',
        'Error JSON:',
        stringifySafe(input.error ?? null, MAX_JSON_PREVIEW),
      ].join('\n');

      const aiResponse = await withTimeout(provider.generateReply(prompt), AI_TIMEOUT_MS);
      const parsed = extractJsonObject(aiResponse);
      if (!parsed) return fallback;

      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
      const bullets = sanitizeStringList(parsed.bullets, 4);
      const suggestedQuestions = sanitizeStringList(parsed.suggestedQuestions, 3);

      if (!summary || bullets.length === 0) return fallback;

      return {
        ...fallback,
        summary: summary.slice(0, 280),
        bullets,
        suggestedQuestions: suggestedQuestions.length === 3 ? suggestedQuestions : fallback.suggestedQuestions,
        generatedBy: 'ai',
      };
    } catch (err) {
      console.warn('[WorkflowSummaryService] Failed to generate AI summary:', err);
      return fallback;
    }
  }
}
