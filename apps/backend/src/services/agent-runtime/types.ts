/**
 * @fileoverview services/agent-runtime/types.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import type { Tool } from "@mastra/core/tools";

/**
 * AgentToolRuntimeContext type alias.
 */
export type AgentToolRuntimeContext = {
    userId: string;
    threadId: string;
    traceId: string;
    approvalMode: "default" | "auto";
};

/**
 * AgentToolMap type alias.
 */
export type AgentToolMap = Record<string, Tool<any, any, any, any>>;

/**
 * AgentRunInput type alias.
 */
export type AgentRunInput = {
    threadId: string;
    content: string;
    traceId: string;
    userId: string;
  providerId?: string;
  model?: string;
};

/**
 * AgentRunOutput type alias.
 */
export type AgentRunOutput = {
    text: string;
    blocks: Array<Record<string, unknown>>;
  meta?: {
    toolCalls?: Array<{ toolName: string; args?: unknown }>;
    stepCount?: number;
        runtime: "mastra_runtime";
        model: string;
    provider?: string;
    selectedModel?: string;
    routingMode?: "auto" | "explicit";
    failoverCount?: number;
    attempts?: Array<{
            provider: string;
            model: string;
            ok: boolean;
      latencyMs?: number;
      error?: string;
    }>;
        mcpToolsLoaded: number;
  };
};
