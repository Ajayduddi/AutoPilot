import { ILLMProvider, WorkflowContext, ParsedIntent, ConversationMessage, RetrievedContext } from './provider.interface';

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
2) Direct action requests for workflow data -> workflow.
3) Personal data questions -> workflow if matching workflow exists.
4) Use exact workflow keys only. Never invent keys.
5) If uncertain, return chat.
6) Include short helpful chat reply for type=chat.`;

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
- Mention workflows only when relevant to user data requests.`;

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

  async parseIntent(
    message: string,
    workflows: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<ParsedIntent> {
    console.log(`[Gemini] Intention matching on ${this.modelName}`);

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
      console.error('[Gemini] parseIntent error:', e);
      return { type: 'chat', reply: await this.generateReply(message, workflows, history, context) };
    }
  }

  async generateReply(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<string> {
    try {
      const systemPrompt = this.buildChatSystemPrompt(workflows, context);
      return await this.callGeminiFromMessages(systemPrompt, message, history, 0.7);
    } catch (e: any) {
      console.error('[Gemini] generateReply error:', e);
      return `Error generating reply from Gemini: ${e.message}`;
    }
  }

  async *generateReplyStream(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): AsyncGenerator<string> {
    // Fallback non-streaming Gemini call for now; yields as a single chunk.
    const text = await this.generateReply(message, workflows, history, context);
    yield text;
  }
}
