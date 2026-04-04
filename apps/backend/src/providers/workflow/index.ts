/**
 * @fileoverview providers/workflow/index.
 *
 * External provider adapters and interfaces for LLMs and workflow engines.
 */
// ─────────────────────────────────────────────────────────────
//  Workflow Provider Module — Public API
// ─────────────────────────────────────────────────────────────

/** Public adapter contract used by workflow provider implementations. */
export type { WorkflowProviderAdapter } from './provider.interface';
/** Shared workflow-provider DTOs used by adapters, services, and routes. */
export type {
  ValidationResult,
  NormalizedProviderResult,
  NormalizedProviderError,
  RunContext,
  RunDetails,
  RunStep,
  HealthCheckResult,
} from './types';

export { WorkflowProviderFactory } from './factory';
export { N8nAdapter } from './n8n.adapter';
export { ZapierAdapter } from './zapier.adapter';
export { MakeAdapter } from './make.adapter';
export { CustomAdapter } from './custom.adapter';
export { SimAdapter } from './sim.adapter';
export { BaseWebhookAdapter } from './base.adapter';
