/**
 * @fileoverview providers/workflow/types.
 *
 * External provider adapters and interfaces for LLMs and workflow engines.
 */
import type { NormalizedResult, WorkflowRunStatus } from '@autopilot/shared';

// ─────────────────────────────────────────────────────────────
//  Provider Adapter Internal Types
// ─────────────────────────────────────────────────────────────

/** Result of validateConfig — tells the caller whether the workflow is correctly configured for this provider */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/** Normalized result extracted from a raw provider response */
export interface NormalizedProviderResult {
    status: WorkflowRunStatus;
    result: NormalizedResult | null;
    raw: Record<string, unknown>;
    providerRunId: string | null;
}

/** Normalized error extracted from a raw provider error */
export interface NormalizedProviderError {
    status: 'failed';
  error: {
        message: string;
        code: string | null;
        details: Record<string, unknown> | null;
  };
    raw: Record<string, unknown> | null;
}

/** Context passed to fetchRunDetails */
export interface RunContext {
    runId: string;
    traceId: string;
    providerRunId: string | null;
}

/** Detailed run information returned from the provider */
export interface RunDetails {
    providerRunId: string;
    status: WorkflowRunStatus;
    startedAt: string | null;
    finishedAt: string | null;
    steps: RunStep[];
    raw: Record<string, unknown>;
}

/** A single step in a provider's run execution */
export interface RunStep {
    name: string;
    status: 'success' | 'failed' | 'skipped' | 'running';
    startedAt: string | null;
    finishedAt: string | null;
    output: unknown;
}

/** Health check result */
export interface HealthCheckResult {
    healthy: boolean;
    latencyMs: number;
    message: string | null;
}
