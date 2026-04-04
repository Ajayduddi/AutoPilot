/**
 * @fileoverview services/agent-runtime/tools/index.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import type { AgentToolMap, AgentToolRuntimeContext } from "../types";
import { createWorkflowTools } from "./workflow-tools";
import { createApprovalTools } from "./approval-tools";
import { createContextTools } from "./context-tools";
import { createSystemTools } from "./system-tools";

/**
 * createCoreAgentTools function.
 *
 * Performs create core agent tools logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export function createCoreAgentTools(ctx: AgentToolRuntimeContext): AgentToolMap {
  return {
    ...createWorkflowTools(ctx),
    ...createApprovalTools(ctx),
    ...createContextTools(ctx),
    ...createSystemTools(ctx),
  };
}

