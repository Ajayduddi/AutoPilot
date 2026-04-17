/**
 * @fileoverview providers/workflow/provider.interface.
 *
 * High-level purpose:
 * Canonical contract layer for workflow provider adapters, execution requests,
 * and normalized response envelopes.
 * Business value: stabilizes integration boundaries so orchestration logic can
 * switch providers without service-level rewrites.
 * System impact: governs shape/semantics of all workflow create/execute/list
 * interactions throughout backend runtime.
 *
 * Key Features (and trade-offs):
 * - Strongly typed request/result contracts for workflow lifecycle operations.
 * - Explicit auth, configuration, and capability metadata structures.
 * - Provider-independent status and error normalization pattern.
 * - Standardized testing hooks through shared adapter method signatures.
 * - Trade-off: generic abstractions may not expose every provider-specific
 *   advanced feature directly.
 *
 * Usage Guide:
 * 1. Implement `IWorkflowProvider` in each provider adapter.
 * 2. Return `WorkflowOperationResult<T>` for every adapter operation.
 * 3. Map provider-native errors into `error` and `status` consistently.
 * 4. Keep metadata fields additive and backward compatible.
 * 5. Update orchestration tests when extending interface contracts.
 */
import {
  Workflow,
  WorkflowProvider,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  ProviderCapabilities,
} from '@autopilot/shared';
import type {
  ValidationResult,
  NormalizedProviderResult,
  NormalizedProviderError,
  RunContext,
  RunDetails,
  HealthCheckResult,
} from './types';

// ─────────────────────────────────────────────────────────────
//  Workflow Provider Adapter Interface
// ─────────────────────────────────────────────────────────────

/**
 * Every provider adapter must implement this interface.
 *
 * Required methods:
 *   - validateConfig  — verify that a workflow's provider config is well-formed
 *   - triggerWorkflow  — dispatch execution to the external provider
 *   - normalizeResponse — turn raw provider output into a common shape
 *   - normalizeError    — turn raw provider error into a common shape
 *
 * Optional methods (implement only if the provider supports them):
 *   - fetchRunDetails  — query the provider for detailed run information
 *   - healthCheck      — ping the provider to verify connectivity
 */
export interface WorkflowProviderAdapter {
  /** Unique provider identifier (must match WorkflowProvider literal) */
  readonly name: WorkflowProvider;

  /** What this provider can and cannot do (v1 baseline) */
  readonly capabilities: ProviderCapabilities;

  /**
   * Validate that a workflow's configuration is complete & correct
   * for this provider (e.g. endpoint URL present, auth config valid).
   */
  validateConfig(workflow: Workflow): Promise<ValidationResult>;

  /**
   * Dispatch a trigger to the external provider.
   * Must return a normalized execution result.
   */
  triggerWorkflow(
    workflow: Workflow,
    request: WorkflowExecutionRequest,
  ): Promise<WorkflowExecutionResult>;

  /**
   * Normalize a raw provider response into the common result shape.
   * Called internally by triggerWorkflow; also useful for callback processing.
   */
  normalizeResponse(raw: unknown, workflow: Workflow): NormalizedProviderResult;

  /**
   * Normalize a raw provider error into the common error shape.
   */
  normalizeError(error: unknown, workflow: Workflow): NormalizedProviderError;

  /**
   * Query the provider for detailed run information.
   * Return `null` if not supported or data unavailable.
   */
  fetchRunDetails?(workflow: Workflow, context: RunContext): Promise<RunDetails | null>;

  /**
   * Ping the provider to verify connectivity / reachability.
   */
  healthCheck?(workflow: Workflow): Promise<HealthCheckResult>;
}
