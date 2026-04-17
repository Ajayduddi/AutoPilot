/**
 * @fileoverview providers/workflow/types.
 *
 * High-level purpose:
 * Shared type primitives for workflow-node operations, metadata payloads, and
 * adapter utility contracts.
 * Business value: keeps provider implementations and services aligned on
 * operation shapes with strong compile-time guarantees.
 * System impact: type foundation consumed across workflow adapters and tests.
 *
 * Key Features (and trade-offs):
 * - Reusable operation result/type aliases for adapter implementations.
 * - Consistent metadata shape for execution tracing.
 * - Lightweight contracts for node CRUD/update helper flows.
 * - Supports extension with additive fields for new provider needs.
 * - Trade-off: broad shared types can drift if not governed by contract tests.
 *
 * Usage Guide:
 * 1. Import these types in provider adapters and services.
 * 2. Keep additive changes backward compatible for existing consumers.
 * 3. Update related shared interfaces when introducing new operation fields.
 * 4. Mirror type changes in adapter and orchestrator tests.
 * 5. Prefer explicit type aliases over `any` for provider payload handling.
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
