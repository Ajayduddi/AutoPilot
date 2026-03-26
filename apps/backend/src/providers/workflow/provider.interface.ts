import type {
  Workflow,
  WorkflowProvider,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  ProviderCapabilities,
} from '@chat-automation/shared';
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
