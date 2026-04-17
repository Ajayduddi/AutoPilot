/**
 * @fileoverview services/agent-runtime/tools/index.
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

