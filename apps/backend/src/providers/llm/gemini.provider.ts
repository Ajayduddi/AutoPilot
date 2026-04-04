/**
 * @fileoverview providers/llm/gemini.provider.
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
 * Gemini-backed implementation of the platform LLM provider contract.
 *
 * @remarks
 * Handles:
 * - intent parsing (workflow vs chat decisions),
 * - standard text generation,
 * - multimodal extraction for image/audio/document inputs.
 */
export class GeminiProvider implements ILLMProvider {
  name = 'gemini';

    constructor(private apiKey: string, private modelName: string) {}

    private getModelPath(): string {
    return this.modelName.startsWith('models/') ? this.modelName : `models/${this.modelName}`;
  }

    private buildHistoryMessages(history?: ConversationMessage[]): { role: string; parts: Array<{ text: string }> }[] {
    if (!history?.length) return [];
    return history
      .filter((h) => h.role === 'user' || h.role === 'assistant')
      .map((h) => ({
                role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      }));
  }

    private appendContextToSystemPrompt(system: string, context?: RetrievedContext): string {
    if (!context?.formatted) return system;
    return `${system}\n\n${context.formatted}`;
  }

    private extractText(data: any): string {
        const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
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

    private async callGemini(prompt: string, temperature = 0.2): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Gemini API key is missing.');
    }

        const url = `https://generativelanguage.googleapis.com/v1beta/${this.getModelPath()}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
        },
      }),
    });

    if (!response.ok) {
            const body = await response.text().catch(() => '');
      throw new Error(`Gemini API Error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
    }

        const data = await response.json();
    return this.extractText(data);
  }

  private async callGeminiFromMessages(
    systemPrompt: string,
    message: string,
    history?: ConversationMessage[],
    temperature = 0.7,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Gemini API key is missing.');
    }

        const url = `https://generativelanguage.googleapis.com/v1beta/${this.getModelPath()}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          role: 'system',
          parts: [{ text: systemPrompt }],
        },
        contents: [...this.buildHistoryMessages(history), { role: 'user', parts: [{ text: message }] }],
        generationConfig: {
          temperature,
        },
      }),
    });

    if (!response.ok) {
            const body = await response.text().catch(() => '');
      throw new Error(`Gemini API Error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
    }

        const data = await response.json();
        const text = this.extractText(data);
    if (!text) throw new Error('Gemini returned empty content.');
    return text;
  }

    private buildIntentSystemPrompt(workflows: WorkflowContext[], context?: RetrievedContext): string {
        const workflowList = workflows
      .map((w) => {
                const status = w.enabled ? 'active' : 'disabled';
                const tags = w.tags?.length ? ` [${w.tags.join(', ')}]` : '';
        return `- ${w.key} (${w.name}) — ${w.provider} — ${status}${tags}\n  ${w.description || 'No description'}`;
      })
      .join('\n');

        let prompt = `You are AutoPilot, an automation assistant. Classify the user message as either workflow trigger or chat.

Available workflows:
${workflowList}

Return valid JSON only (no markdown):
- Workflow: { "type": "workflow", "workflowKey": "<exact key from list>", "parameters": {} }
- Chat:     { "type": "chat", "reply": "<response>" }

Rules:
1) Greetings/statements -> chat.
2) Trigger workflow only when execution is explicitly requested (run/trigger/execute/retry/rescan/refresh).
3) Follow-up questions about previous workflow results should be chat answers from context, not reruns.
4) Personal data questions -> workflow if matching workflow exists and execution is explicitly requested; otherwise chat with available context.
5) Use exact workflow keys only. Never invent keys.
6) If uncertain, return chat.
7) Include short helpful chat reply for type=chat.
8) Do NOT guess current date/time values; use deterministic runtime clock context when provided.`;

    prompt = this.appendContextToSystemPrompt(prompt, context);
    return prompt;
  }

    private buildChatSystemPrompt(workflows?: WorkflowContext[], context?: RetrievedContext): string {
        const base = `You are AutoPilot — a friendly, concise automation assistant.

IDENTITY RULES:
- "I", "me", "my", "mine" refer to the human user.
- You are AutoPilot.
- If user asks personal data and it is not in history/context, say you do not have it yet and briefly mention a workflow can fetch it.

BEHAVIOR:
- Answer coding/math/general questions normally.
- Mention workflows only when relevant to user data requests.
- Never guess real-time date/time values; rely on deterministic runtime clock context when present.`;

        let prompt = base;
    if (workflows?.length) {
            const wfList = workflows
        .filter((w) => w.enabled)
        .map((w) => `- "${w.name}" — ${w.description || 'No description'}`)
        .join('\n');
      prompt += `\n\nAvailable automations:\n${wfList}`;
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

  /**
   * Classifies a user turn as workflow-trigger intent or standard chat.
   *
   * @param message - Current user message.
   * @param workflows - Available workflow catalog for exact-key matching.
   * @param history - Optional recent conversation history.
   * @param context - Optional retrieved context payload for grounding.
   * @returns Parsed intent object compatible with orchestrator routing.
   */
  async parseIntent(
    message: string,
    workflows: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<ParsedIntent> {
    logger.debug({
      scope: 'llm.gemini',
      message: 'Intent matching request',
      model: this.modelName,
    });

    try {
            const systemPrompt = this.buildIntentSystemPrompt(workflows, context);
            const raw = await this.callGeminiFromMessages(systemPrompt, message, history, 0.1);
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as ParsedIntent;

      if (parsed.type === 'workflow' && parsed.workflowKey) {
                const exists = workflows.some((w) => w.key === parsed.workflowKey);
        if (!exists) {
          return { type: 'chat', reply: "I couldn't map that to a known workflow. Could you rephrase?" };
        }
      }

      return parsed;
    } catch (e) {
      logger.error({ scope: 'llm.gemini', message: 'parseIntent error', model: this.modelName, err: e });
      return { type: 'chat', reply: await this.generateReply(message, workflows, history, context) };
    }
  }

  /**
   * Generates a non-streaming assistant response from Gemini.
   *
   * @param message - Current user prompt.
   * @param workflows - Optional workflow catalog for contextual guidance.
   * @param history - Optional recent conversation history.
   * @param context - Optional retrieved context payload for grounding.
   * @param options - Response mode and generation preferences.
   * @returns Final assistant text response.
   * @throws {Error} When Gemini request fails or returns invalid output.
   */
  async generateReply(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
    options?: LlmGenerationOptions,
  ): Promise<string> {
    try {
            const systemPrompt = this.buildReplySystemPrompt(options?.responseMode, workflows, context);
      return await this.callGeminiFromMessages(systemPrompt, message, history, options?.responseMode === 'email_draft_v1' ? 0.2 : 0.7);
    } catch (e: any) {
      logger.error({ scope: 'llm.gemini', message: 'generateReply error', model: this.modelName, err: e });
      throw new Error(`Gemini generateReply failed: ${e?.message || 'unknown error'}`);
    }
  }

  /**
   * Streaming reply adapter for Gemini provider.
   *
   * @remarks
   * Currently emits a single chunk from the non-streaming implementation.
   */
  async *generateReplyStream(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
    options?: LlmGenerationOptions,
  ): AsyncGenerator<string> {
    // Fallback non-streaming Gemini call for now; yields as a single chunk.
        const text = await this.generateReply(message, workflows, history, context, options);
    yield text;
  }

  /**
   * Extracts OCR and high-level metadata from an image input.
   *
   * @param input - Image payload (filename, MIME type, bytes).
   * @returns Structured extraction response used by attachment processing.
   * @throws {Error} When Gemini API key is missing or remote request fails.
   */
  async analyzeImage(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<{
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
  }> {
    if (!this.apiKey) throw new Error('Gemini API key is missing.');
        const url = `https://generativelanguage.googleapis.com/v1beta/${this.getModelPath()}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Analyze this image and return strict JSON: {"summary":"...", "ocrText":"...", "entities":["..."], "tags":["..."]}' },
              {
                inline_data: {
                  mime_type: input.mimeType,
                  data: this.toBase64(input.bytes),
                },
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      }),
    });
    if (!response.ok) {
            const body = await response.text().catch(() => '');
      throw new Error(`Gemini image analysis failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
    }
        const data = await response.json();
        const text = this.extractText(data);
        const parsed = this.safeJsonParse<{ summary?: string; ocrText?: string; entities?: string[]; tags?: string[] }>(text);
    return {
      extractedText: parsed?.ocrText || null,
      structuredMetadata: {
        kind: 'image',
        entities: parsed?.entities || [],
        tags: parsed?.tags || [],
      },
      previewData: {
        summary: parsed?.summary || 'Image analyzed successfully.',
        snippet: parsed?.ocrText ? parsed.ocrText.slice(0, 500) : null,
      },
    };
  }

  /**
   * Transcribes audio and returns summary metadata.
   *
   * @param input - Audio payload (filename, MIME type, bytes).
   * @returns Structured transcription response used by attachment processing.
   * @throws {Error} When Gemini API key is missing or remote request fails.
   */
  async transcribeAudio(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<{
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
  }> {
    if (!this.apiKey) throw new Error('Gemini API key is missing.');
        const url = `https://generativelanguage.googleapis.com/v1beta/${this.getModelPath()}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Transcribe this audio and return strict JSON: {"transcript":"...", "summary":"...", "language":"..."}',
              },
              {
                inline_data: {
                  mime_type: input.mimeType,
                  data: this.toBase64(input.bytes),
                },
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      }),
    });
    if (!response.ok) {
            const body = await response.text().catch(() => '');
      throw new Error(`Gemini audio transcription failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
    }
        const data = await response.json();
        const text = this.extractText(data);
        const parsed = this.safeJsonParse<{ transcript?: string; summary?: string; language?: string }>(text);
    return {
      extractedText: parsed?.transcript || null,
      structuredMetadata: {
        kind: 'audio',
        language: parsed?.language || null,
      },
      previewData: {
        summary: parsed?.summary || 'Audio processed successfully.',
        snippet: parsed?.transcript ? parsed.transcript.slice(0, 500) : null,
      },
    };
  }

  /**
   * Summarizes extracted document text using Gemini.
   *
   * @param input - Document payload with optional extracted text hint.
   * @returns Structured document summary response for chat context blocks.
   */
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
        const extracted = (input.extractedTextHint || '').trim();
    if (!extracted) {
      return {
        extractedText: null,
        structuredMetadata: { kind: 'document', mimeType: input.mimeType },
        previewData: { summary: 'Document uploaded. Deep summary requires extracted text.' },
      };
    }
        const prompt = `You are a document analyst. Summarize this document text and return strict JSON:
{"summary":"...", "bullets":["..."], "keyEntities":["..."]}.

Document text:
${extracted.slice(0, 20000)}`;
        const raw = await this.callGemini(prompt, 0.2);
        const parsed = this.safeJsonParse<{ summary?: string; bullets?: string[]; keyEntities?: string[] }>(raw);
    return {
      extractedText: extracted,
      structuredMetadata: {
        kind: 'document',
        mimeType: input.mimeType,
        bullets: parsed?.bullets || [],
        keyEntities: parsed?.keyEntities || [],
      },
      previewData: {
        summary: parsed?.summary || 'Document analyzed successfully.',
        snippet: extracted.slice(0, 500),
      },
    };
  }
}
