/**
 * @fileoverview providers/llm/ollama.provider.
 *
 * External provider adapters and interfaces for LLMs and workflow engines.
 */
import {
  ILLMProvider,
  WorkflowContext,
  ParsedIntent,
  ConversationMessage,
  RetrievedContext,
  LlmGenerationOptions,
  LlmResponseMode,
} from './provider.interface';
import { logger } from '../../util/logger';

/**
 * OllamaProvider class.
 *
 * Encapsulates ollama provider behavior for provider integration logic.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class OllamaProvider implements ILLMProvider {
  name = 'ollama';

    constructor(private modelName: string, private baseUrl: string, private apiKey?: string) {
    this.baseUrl = this.baseUrl.replace(/\/$/, "");
  }

    private buildHeaders(contentType = true): Record<string, string> {
        const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = 'application/json';
    if (this.apiKey?.trim()) headers['Authorization'] = `Bearer ${this.apiKey.trim()}`;
    return headers;
  }

  // ── Shared helpers ───────────────────────────────────────────────

    private buildHistoryMessages(history?: ConversationMessage[]): { role: string; content: string }[] {
    if (!history?.length) return [];
    return history.map(h => ({ role: h.role, content: h.content }));
  }

    private appendContextToSystemPrompt(system: string, context?: RetrievedContext): string {
    if (!context?.formatted) return system;
    return `${system}\n\n${context.formatted}`;
  }

  private safeJsonParse<T>(text: string): T | null {
    try {
            const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
            const candidate = fenced?.[1] || text;
            const jsonMatch = candidate.match(/\{[\s\S]*\}/);
      return JSON.parse(jsonMatch ? jsonMatch[0] : candidate) as T;
    } catch {
      return null;
    }
  }

    private findWorkflowMatch(message: string, workflows: WorkflowContext[]): WorkflowContext | null {
        const text = String(message || '').toLowerCase();
    if (!text.trim()) return null;

        let best: { workflow: WorkflowContext; score: number } | null = null;
    for (const workflow of workflows) {
            let score = 0;
            const key = String(workflow.key || '').toLowerCase();
            const name = String(workflow.name || '').toLowerCase();
            const description = String(workflow.description || '').toLowerCase();
            const tags = Array.isArray(workflow.tags) ? workflow.tags.map((t) => String(t).toLowerCase()) : [];

      if (key && text.includes(key)) score += 10;
      if (name && text.includes(name)) score += 8;
      if (description) {
                const tokens = description.split(/\W+/).filter((t) => t.length >= 4).slice(0, 20);
        for (const token of tokens) {
          if (text.includes(token)) score += 1;
        }
      }
      for (const tag of tags) {
        if (tag && text.includes(tag)) score += 3;
      }

      if (!best || score > best.score) best = { workflow, score };
    }

    return best && best.score >= 5 ? best.workflow : null;
  }

    private extractRecentWorkflowKey(context?: RetrievedContext): string | null {
        const formatted = String(context?.formatted || '');
    if (!formatted) return null;
        const match = formatted.match(/workflowKey["'\s:=-]+([a-zA-Z0-9._-]+)/i)
      || formatted.match(/Workflow:\s+.*\(([a-zA-Z0-9._-]+)\)/i)
      || formatted.match(/\b([a-zA-Z0-9._-]+)\b(?=.*selected workflow)/i);
    return match?.[1]?.trim() || null;
  }

  private buildHeuristicIntent(
    message: string,
    workflows: WorkflowContext[],
    context?: RetrievedContext,
  ): ParsedIntent {
        const raw = String(message || '').trim();
        const lower = raw.toLowerCase();
        const recentWorkflowKey = this.extractRecentWorkflowKey(context);
        const matchedWorkflow = this.findWorkflowMatch(raw, workflows);

        const explicitExecution =
      /\b(run|trigger|execute|retry|rerun|refresh|rescan|fetch|get|load)\b/i.test(raw);
        const confirmation =
      /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please|please do|run it|go for it|proceed|continue)\b/i.test(raw);

    if ((confirmation || explicitExecution) && (matchedWorkflow?.key || recentWorkflowKey)) {
      return {
        type: 'workflow',
        workflowKey: matchedWorkflow?.key || recentWorkflowKey || undefined,
        parameters: {},
      };
    }

    if (matchedWorkflow && /\b(my|me|i|mine)\b/i.test(raw) && /\b(experience|portfolio|profile|career|job|work|skills|education)\b/i.test(raw)) {
      return {
        type: 'workflow',
        workflowKey: matchedWorkflow.key,
        parameters: {},
      };
    }

    return {
      type: 'chat',
      reply: "I couldn't confidently classify that as a workflow trigger, so I'm treating it as a normal chat turn.",
    };
  }

  // ── parseIntent ──────────────────────────────────────────────────

  async parseIntent(
    message: string,
    workflows: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<ParsedIntent> {
    logger.debug({
      scope: 'llm.ollama',
      message: 'Intent matching request',
      model: this.modelName,
      baseUrl: this.baseUrl,
    });

        const workflowList = workflows
      .map(w => {
                const status = w.enabled ? '✓ active' : '✗ disabled';
                const tags = w.tags?.length ? ` [${w.tags.join(', ')}]` : '';
        return `- ${w.key} (${w.name}) — ${w.provider} — ${status}${tags}\n  ${w.description || 'No description'}`;
      })
      .join('\n');

        let systemPrompt = `You are AutoPilot, an intelligent automation assistant. Classify the user's message as either a workflow trigger or a chat reply.

Available workflows:
${workflowList}

OUTPUT FORMAT — reply with valid JSON only, no markdown:
  Workflow: { "type": "workflow", "workflowKey": "<exact key from list>", "parameters": {} }
  Chat:     { "type": "chat", "reply": "<your response>" }

DECISION TREE — follow in order:
1. GREETINGS & STATEMENTS: "hello", "thanks", "my name is X", "I work at Y" → chat. The user is telling you something, not requesting data.
2. HISTORY CHECK: If the conversation history already contains the answer (user previously said it or a workflow already returned it), answer from that data → chat.
3. ACTION REQUESTS: Trigger workflow only when user explicitly requests execution (run/trigger/execute/retry/rescan/refresh). For normal follow-up questions, answer from recent workflow/context instead of re-triggering.
4. PERSONAL DATA QUESTIONS: "what is my name?", "where did I study?", "show my skills" → Match to the workflow whose data would contain the answer (e.g. portfolio, profile, scores). The word "I/my/me" ALWAYS means the human user.
5. CONFIRMATIONS: "yes", "sure", "do it", "go ahead" → If a workflow was recently suggested or discussed, trigger that workflow.
6. FOLLOW-UP: "run it again", "retry", "show previous result" → re-trigger the last workflow from retrieved context.
7. GENERAL QUESTIONS: coding help, math, explanations, creative writing → chat.
8. EXACT KEYS ONLY: workflowKey MUST be copied verbatim from the list. Never invent keys. If unsure → chat.
9. Extract parameters when the user provides input data (search query, name, email, etc.).

CRITICAL: Avoid unnecessary workflow reruns on follow-up questions. Prefer context-grounded chat answers unless execution is explicitly requested.
CRITICAL: Do NOT guess current date/time. If deterministic clock metadata is available, use that and do not fabricate temporal values.`;

    systemPrompt = this.appendContextToSystemPrompt(systemPrompt, context);

        const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
      ...this.buildHistoryMessages(history),
      { role: 'user', content: message },
    ];

    try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: JSON.stringify({
          model: this.modelName,
          messages,
          stream: false,
          format: 'json',
          options: { temperature: 0.1 }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API Error: ${response.status} ${response.statusText}`);
      }
      
            const data = await response.json();
            const content = String(data?.message?.content || '');
            const parsed = this.safeJsonParse<ParsedIntent>(content);
      if (parsed?.type === 'workflow' && parsed.workflowKey) {
                const exists = workflows.some((w) => w.key === parsed.workflowKey);
        if (exists) return parsed;
      }
      if (parsed?.type === 'chat') {
        return {
          type: 'chat',
          reply: String(parsed.reply || '').trim() || "I'm treating this as a chat request.",
        };
      }

            const heuristic = this.buildHeuristicIntent(message, workflows, context);
      logger.warn({
        scope: 'llm.ollama',
                message: 'parseIntent returned non-JSON or invalid workflow key; using heuristic intent',
        model: this.modelName,
        preview: content.slice(0, 160),
      });
      return heuristic;
    } catch (e) {
      logger.error({ scope: 'llm.ollama', message: 'parseIntent error', model: this.modelName, err: e });
      return this.buildHeuristicIntent(message, workflows, context);
    }
  }

  // ── Chat system prompt builder ───────────────────────────────────

  private buildChatSystemPrompt(
    workflows?: WorkflowContext[],
    context?: RetrievedContext,
  ): string {
        const base = `You are AutoPilot — a friendly, concise automation assistant.

IDENTITY RULES:
- "I", "me", "my", "mine" ALWAYS refer to the human user, NEVER to you.
- You are AutoPilot. Never confuse yourself with the user.
- If the user asks about themselves and you don't have the answer in conversation history or retrieved context, say you don't have that data yet. Mention which workflow could fetch it, but keep it brief.

BEHAVIOR:
- Answer general questions (coding, math, concepts, creative writing) normally.
- Only mention workflows when the user's question is specifically about data a workflow provides.
- Never guess real-time date/time values; rely on deterministic runtime clock context when present.`;
        let prompt = base;
    if (workflows?.length) {
            const wfList = workflows
        .filter(w => w.enabled)
        .map(w => `- "${w.name}" — ${w.description || 'No description'}`)
        .join('\n');
      prompt += `\n\nYou also have access to these automation workflows:\n${wfList}\n\nOnly mention workflows if the user's question is directly about data a workflow provides (e.g. their personal info, scores, or stats). For all other questions (coding, math, general knowledge, creative writing, etc.), answer normally without mentioning workflows.`;
    }
    return this.appendContextToSystemPrompt(prompt, context);
  }

    private buildEmailDraftSystemPrompt(context?: RetrievedContext): string {
        const prompt = `You are AutoPilot. Generate email drafts using STRICT JSON output.

Return ONLY valid JSON, with no markdown fences and no extra prose:
{
  "intro": "optional short intro",
  "drafts": [
    {
      "label": "optional style label",
      "subject": "email subject",
      "bodyMarkdown": "letter body in markdown"
    }
  ],
  "outro": "optional short outro"
}

Rules:
1. "drafts" must contain at least 1 item.
2. Each draft must include non-empty "subject" and non-empty "bodyMarkdown".
3. Keep bodyMarkdown as proper letter format with paragraph breaks.
4. Do not include style labels (Professional/Friendly/Formal) inside bodyMarkdown. Put those in "label".
5. Do not include helper prompts like "Want me to..." inside bodyMarkdown.
6. If unsure, return one safe draft with empty intro/outro.
7. No keys other than intro, drafts, outro, and draft-level label/subject/bodyMarkdown.
8. Do NOT guess current date/time values; rely on deterministic runtime clock context when present.`;
    return this.appendContextToSystemPrompt(prompt, context);
  }

  private buildReplySystemPrompt(
    mode: LlmResponseMode | undefined,
    workflows?: WorkflowContext[],
    context?: RetrievedContext,
  ): string {
    if (mode === 'email_draft_v1') {
      return this.buildEmailDraftSystemPrompt(context);
    }
    return this.buildChatSystemPrompt(workflows, context);
  }

  // ── generateReply ────────────────────────────────────────────────

  async generateReply(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
    options?: LlmGenerationOptions,
  ): Promise<string> {
    try {
            const messages: { role: string; content: string }[] = [
        { role: 'system', content: this.buildReplySystemPrompt(options?.responseMode, workflows, context) },
        ...this.buildHistoryMessages(history),
        { role: 'user', content: message },
      ];

            const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: JSON.stringify({
          model: this.modelName,
          messages,
          stream: false,
                    options: { temperature: options?.responseMode === 'email_draft_v1' ? 0.2 : 0.7 },
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API Error: ${response.status} ${response.statusText}`);
      }
      
            const data = await response.json();
      return data.message.content;
    } catch (e: any) {
      logger.error({ scope: 'llm.ollama', message: 'generateReply error', model: this.modelName, err: e });
      throw new Error(`Ollama generateReply failed: ${e?.message || 'unknown error'}`);
    }
  }

  // ── generateReplyStream ──────────────────────────────────────────

  async *generateReplyStream(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
    options?: LlmGenerationOptions,
  ): AsyncGenerator<string> {
        const messages: { role: string; content: string }[] = [
      { role: 'system', content: this.buildReplySystemPrompt(options?.responseMode, workflows, context) },
      ...this.buildHistoryMessages(history),
      { role: 'user', content: message },
    ];

        const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this.buildHeaders(true),
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: true,
                options: { temperature: options?.responseMode === 'email_draft_v1' ? 0.2 : 0.7 }
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama streaming error: ${response.status} ${response.statusText}`);
    }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
                    const trimmed = line.trim();
          if (!trimmed) continue;
          try {
                        const parsed = JSON.parse(trimmed);
            if (parsed.message?.content) yield parsed.message.content;
            if (parsed.done) return;
          } catch { /* ignore malformed lines */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
