/**
 * @fileoverview providers/workflow/index.
 *
 * High-level purpose:
 * Workflow provider barrel that centralizes export surface for adapters,
 * contracts, and factory utilities.
 * Business value: simplifies imports and reduces coupling to file layout across
 * orchestration and service layers.
 * System impact: public module boundary for workflow provider subsystem.
 *
 * Key Features (and trade-offs):
 * - Single import entrypoint for provider interfaces and adapter classes.
 * - Export normalization for factory and shared workflow types.
 * - Helps enforce subsystem boundaries in dependent modules.
 * - Improves discoverability for new contributors.
 * - Trade-off: barrel exports can hide dependency direction if overused.
 *
 * Usage Guide:
 * 1. Prefer importing workflow provider APIs from this barrel.
 * 2. Keep export list curated and backward compatible.
 * 3. Add new adapter/type exports intentionally with review.
 * 4. Avoid re-exporting unrelated domain modules.
 * 5. Validate downstream imports after export surface changes.
 */
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
