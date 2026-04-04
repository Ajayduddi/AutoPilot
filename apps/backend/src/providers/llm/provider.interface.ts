/**
 * ParsedIntent type alias.
 */
export type ParsedIntent = {
    type: 'chat' | 'workflow';
  workflowKey?: string;
  parameters?: Record<string, any>;
  reply?: string;
};

/**
 * WorkflowContext type contract.
 */
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

/**
 * LlmResponseMode type alias.
 */
export type LlmResponseMode = 'default' | 'email_draft_v1';

/**
 * LlmGenerationOptions type contract.
 */
export interface LlmGenerationOptions {
  responseMode?: LlmResponseMode;
}

/**
 * ILLMProvider type contract.
 */
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
    options?: LlmGenerationOptions,
  ): Promise<string>;
  /** Optional: stream reply tokens. Falls back to generateReply if not implemented. */
  generateReplyStream?(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
    options?: LlmGenerationOptions,
  ): AsyncGenerator<string>;

  /**
   * Optional provider-native multimodal hooks.
   * If not implemented by a provider, callers should fall back to deterministic parsing.
   */
  analyzeImage?(input: {
        filename: string;
        mimeType: string;
        bytes: Uint8Array;
  }): Promise<{
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
  }>;

  transcribeAudio?(input: {
        filename: string;
        mimeType: string;
        bytes: Uint8Array;
  }): Promise<{
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
  }>;

  summarizeDocument?(input: {
        filename: string;
        mimeType: string;
        bytes: Uint8Array;
    extractedTextHint?: string | null;
  }): Promise<{
    extractedText?: string | null;
    structuredMetadata?: Record<string, unknown> | null;
    previewData?: Record<string, unknown> | null;
  }>;
}
