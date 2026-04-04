/**
 * @fileoverview providers/llm/openai.provider.
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
 * OpenAIProvider class.
 *
 * Encapsulates open aiprovider behavior for provider integration logic.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class OpenAIProvider implements ILLMProvider {
  name = 'openai';

    constructor(private modelName: string, private apiKey: string, private baseUrl: string) {
    this.baseUrl = this.baseUrl.replace(/\/$/, "");
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

    private toBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  }

  private safeJsonParse<T>(text: string): T | null {
    try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
      return JSON.parse(jsonMatch ? jsonMatch[0] : text) as T;
    } catch {
      return null;
    }
  }

  // ── parseIntent ──────────────────────────────────────────────────

  async parseIntent(
    message: string,
    workflows: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<ParsedIntent> {
    logger.debug({
      scope: 'llm.openai',
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
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelName,
          messages,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`);
      }
      
            const data = await response.json();
            const content = data.choices[0].message.content;
      
      // Extract JSON from potential markdown blocks
            const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
         return JSON.parse(jsonMatch[0]) as ParsedIntent;
      }
      return JSON.parse(content) as ParsedIntent;
    } catch (e) {
      logger.error({ scope: 'llm.openai', message: 'parseIntent error', model: this.modelName, err: e });
      // Fallback intent proxy logic in case model fails to output JSON
            const msg = message.toLowerCase();
      if (msg.includes('email') || msg.includes('scan')) {
        return { type: 'workflow', workflowKey: 'wf_scan_emails', parameters: {} };
      }
      if (msg.includes('task') || msg.includes('todo')) {
         return { type: 'workflow', workflowKey: 'wf_create_task', parameters: { text: message } };
      }
      
      return { type: 'chat', reply: await this.generateReply(message) };
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

            const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelName,
          messages,
                    temperature: options?.responseMode === 'email_draft_v1' ? 0.2 : 0.7,
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`);
      }
      
            const data = await response.json();
      return data.choices[0].message.content;
    } catch (e: any) {
      logger.error({ scope: 'llm.openai', message: 'generateReply error', model: this.modelName, err: e });
      throw new Error(`OpenAI-compatible generateReply failed: ${e?.message || 'unknown error'}`);
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

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: true,
                temperature: options?.responseMode === 'email_draft_v1' ? 0.2 : 0.7,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`OpenAI streaming error: ${response.status} ${response.statusText}`);
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
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch { /* ignore malformed chunks */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async analyzeImage(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<{
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
  }> {
        const dataUrl = `data:${input.mimeType};base64,${this.toBase64(input.bytes)}`;
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this image. Return strict JSON: {"summary":"...", "ocrText":"...", "entities":["..."], "tags":["..."]}. Keep OCR text concise.',
              },
              {
                type: 'image_url',
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI image analysis failed: ${response.status} ${response.statusText}`);
    }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const parsed = this.safeJsonParse<{ summary?: string; ocrText?: string; entities?: string[]; tags?: string[] }>(String(content));
        const summary = parsed?.summary || 'Image analyzed successfully.';
        const ocrText = parsed?.ocrText || '';
    return {
      extractedText: ocrText || null,
      structuredMetadata: {
        kind: 'image',
        entities: parsed?.entities || [],
        tags: parsed?.tags || [],
      },
      previewData: {
        summary,
        snippet: ocrText ? ocrText.slice(0, 500) : null,
      },
    };
  }

  async transcribeAudio(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<{
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
  }> {
        const form = new FormData();
        const arrayBuffer = input.bytes.buffer.slice(
      input.bytes.byteOffset,
      input.bytes.byteOffset + input.bytes.byteLength,
    ) as ArrayBuffer;
        const blob = new Blob([arrayBuffer], { type: input.mimeType || 'application/octet-stream' });
    form.append('file', blob, input.filename || 'audio-file');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');

        const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`OpenAI transcription failed: ${response.status} ${response.statusText}`);
    }

        const data = await response.json();
        const text = (data?.text || '').toString();
        const language = data?.language || null;
        const duration = data?.duration ?? null;

        let summary = 'Audio transcribed successfully.';
    if (text) {
            const summarize = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: 'system', content: 'Summarize the transcript in 2-3 concise bullet points.' },
            { role: 'user', content: text.slice(0, 12000) },
          ],
          temperature: 0.2,
        }),
      });
      if (summarize.ok) {
                const summaryJson = await summarize.json();
        summary = summaryJson?.choices?.[0]?.message?.content || summary;
      }
    }

    return {
      extractedText: text || null,
      structuredMetadata: {
        kind: 'audio',
        language,
        durationSeconds: duration,
      },
      previewData: {
        summary,
        snippet: text ? text.slice(0, 500) : null,
      },
    };
  }

  async summarizeDocument(input: {
        filename: string;
        mimeType: string;
        bytes: Uint8Array;
    extractedTextHint?: string | null;
  }): Promise<{
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
  }> {
        const textHint = (input.extractedTextHint || '').trim();
    if (!textHint) {
      return {
        extractedText: null,
        structuredMetadata: { kind: 'document', mimeType: input.mimeType },
        previewData: { summary: 'Document uploaded. Deep summary requires extracted text.' },
      };
    }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content: 'You are a document analyst. Return strict JSON: {"summary":"...", "bullets":["..."], "keyEntities":["..."]}',
          },
          {
            role: 'user',
            content: textHint.slice(0, 20000),
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI document summary failed: ${response.status} ${response.statusText}`);
    }
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const parsed = this.safeJsonParse<{ summary?: string; bullets?: string[]; keyEntities?: string[] }>(String(content));

    return {
      extractedText: textHint,
      structuredMetadata: {
        kind: 'document',
        mimeType: input.mimeType,
        bullets: parsed?.bullets || [],
        keyEntities: parsed?.keyEntities || [],
      },
      previewData: {
        summary: parsed?.summary || 'Document analyzed successfully.',
        snippet: textHint.slice(0, 500),
      },
    };
  }
}
