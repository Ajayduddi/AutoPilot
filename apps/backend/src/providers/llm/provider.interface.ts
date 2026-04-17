/**
 * @fileoverview providers/llm/provider.interface.
 *
 * High-level purpose:
 * Defines the canonical LLM provider contract used by routing/orchestrator
 * services, ensuring all model vendors expose a unified intent + reply API.
 * Business value: enables provider switching/fallback without rewriting core
 * orchestration logic, reducing integration risk and vendor lock-in.
 * System impact: this contract is the boundary between provider adapters and
 * the rest of backend decision-making flow.
 *
 * Key Features (and trade-offs):
 * - Strongly typed shared intent/reply interfaces.
 * - Optional multimodal methods for image/audio/document analysis.
 * - Trade-off: optional hooks require capability checks at call sites.
 *
 * Usage Guide:
 * 1. Implement `ILLMProvider` in a new adapter file.
 * 2. Ensure `parseIntent` returns stable JSON-compatible `ParsedIntent`.
 * 3. Implement `generateReply` and optional streaming/multimodal hooks.
 * 4. Register adapter creation in `llm.factory.ts`.
 * 5. Validate behavior through orchestrator and fallback-chain tests.
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
