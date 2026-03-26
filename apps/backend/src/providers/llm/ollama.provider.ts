import { ILLMProvider, WorkflowContext, ParsedIntent, ConversationMessage, RetrievedContext } from './provider.interface';

export class OllamaProvider implements ILLMProvider {
  name = 'ollama';

  constructor(private modelName: string, private baseUrl: string) {
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

  // ── parseIntent ──────────────────────────────────────────────────

  async parseIntent(
    message: string,
    workflows: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<ParsedIntent> {
    console.log(`[Ollama] Intention matching on ${this.modelName} via ${this.baseUrl}`);

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
3. ACTION REQUESTS: "check my portfolio", "fetch my details", "scan my emails", "get my scores" → These are commands. Trigger the matching workflow immediately. Do NOT ask "would you like me to run it?" — just trigger it.
4. PERSONAL DATA QUESTIONS: "what is my name?", "where did I study?", "show my skills" → Match to the workflow whose data would contain the answer (e.g. portfolio, profile, scores). The word "I/my/me" ALWAYS means the human user.
5. CONFIRMATIONS: "yes", "sure", "do it", "go ahead" → If a workflow was recently suggested or discussed, trigger that workflow.
6. FOLLOW-UP: "run it again", "retry", "show previous result" → re-trigger the last workflow from retrieved context.
7. GENERAL QUESTIONS: coding help, math, explanations, creative writing → chat.
8. EXACT KEYS ONLY: workflowKey MUST be copied verbatim from the list. Never invent keys. If unsure → chat.
9. Extract parameters when the user provides input data (search query, name, email, etc.).

CRITICAL: When the user asks you to do something — DO IT. Never respond with "Would you like me to run X?" — just trigger the workflow.`;

    systemPrompt = this.appendContextToSystemPrompt(systemPrompt, context);

    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
      ...this.buildHistoryMessages(history),
      { role: 'user', content: message },
    ];

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages,
          stream: false,
          options: { temperature: 0.1 }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const content = data.message.content;
      
      // Extract JSON from potential markdown blocks
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
         return JSON.parse(jsonMatch[0]) as ParsedIntent;
      }
      return JSON.parse(content) as ParsedIntent;
    } catch (e) {
      console.error("[Ollama] parseIntent error:", e);
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
- Only mention workflows when the user's question is specifically about data a workflow provides.`;
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

  // ── generateReply ────────────────────────────────────────────────

  async generateReply(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<string> {
    try {
      const messages: { role: string; content: string }[] = [
        { role: 'system', content: this.buildChatSystemPrompt(workflows, context) },
        ...this.buildHistoryMessages(history),
        { role: 'user', content: message },
      ];

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.message.content;
    } catch (e: any) {
      console.error("[Ollama] generateReply error:", e);
      return `Error generating reply from local Ollama endpoint: ${e.message}`;
    }
  }

  // ── generateReplyStream ──────────────────────────────────────────

  async *generateReplyStream(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): AsyncGenerator<string> {
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: this.buildChatSystemPrompt(workflows, context) },
      ...this.buildHistoryMessages(history),
      { role: 'user', content: message },
    ];

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: true,
        options: { temperature: 0.7 }
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
