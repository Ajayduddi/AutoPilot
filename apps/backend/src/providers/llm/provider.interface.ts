export type ParsedIntent = {
  type: 'chat' | 'workflow';
  workflowKey?: string;
  parameters?: Record<string, any>;
  reply?: string;
};

export interface WorkflowContext {
  key: string;
  name: string;
  description: string | null;
  provider: string;
  enabled: boolean;
  visibility: string;
  tags?: string[];
}

/** A single message from conversation history, used for multi-turn context. */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Additional context retrieved from context-mode memory. */
export interface RetrievedContext {
  /** Pre-formatted context section ready for prompt injection. Empty string = no context. */
  formatted: string;
}

export interface ILLMProvider {
  name: string;
  parseIntent(
    message: string,
    workflows: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<ParsedIntent>;
  generateReply(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<string>;
  /** Optional: stream reply tokens. Falls back to generateReply if not implemented. */
  generateReplyStream?(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): AsyncGenerator<string>;
}
