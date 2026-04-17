/**
 * @fileoverview services/agent-runtime/types.
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import type { Tool } from "@mastra/core/tools";
import type { TemporalResolutionInput } from "../temporal.service";

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
  temporalInput?: TemporalResolutionInput;
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
