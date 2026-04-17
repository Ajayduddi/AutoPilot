/**
 * @fileoverview providers/workflow/factory.
 *
 * High-level purpose:
 * Runtime resolver that creates workflow provider adapters from persisted
 * provider settings and optional explicit provider selection.
 * Business value: allows operations teams to toggle automation backends (n8n,
 * Zapier, Make, custom webhook, simulator) without redeploying backend code.
 * System impact: single decision point for workflow provider instantiation and
 * default-provider fallback behavior.
 *
 * Key Features (and trade-offs):
 * - Retrieves provider configuration from settings storage.
 * - Supports default and override-based provider selection.
 * - Centralized adapter creation with provider-type switch.
 * - Sanitized logging for unsupported provider types.
 * - Trade-off: shared switch grows with provider count and requires strict
 *   tests to avoid regression in selection semantics.
 *
 * Usage Guide:
 * 1. Persist provider records in workflow settings storage.
 * 2. Call `WorkflowProviderFactory.getProvider(providerId?)`.
 * 3. Use returned adapter for create/execute/list node operations.
 * 4. Add new adapters through `createProvider` switch extension.
 * 5. Validate with adapter integration tests and failure-path checks.
 */
import type { WorkflowProvider } from '@autopilot/shared';
import type { WorkflowProviderAdapter } from './provider.interface';
import { N8nAdapter } from './n8n.adapter';
import { ZapierAdapter } from './zapier.adapter';
import { MakeAdapter } from './make.adapter';
import { CustomAdapter } from './custom.adapter';
import { SimAdapter } from './sim.adapter';
import { logger } from '../../util/logger';

// ─────────────────────────────────────────────────────────────
//  Workflow Provider Factory
// ─────────────────────────────────────────────────────────────
//
//  Central registry of provider adapters.
//  Resolves a WorkflowProvider enum value to the concrete adapter.
// ─────────────────────────────────────────────────────────────

/**
 * WorkflowProviderRegistry class.
 */
class WorkflowProviderRegistry {
  private adapters = new Map<WorkflowProvider, WorkflowProviderAdapter>();

    constructor() {
    // Register all built-in adapters
    this.register(new N8nAdapter());
    this.register(new ZapierAdapter());
    this.register(new MakeAdapter());
    this.register(new CustomAdapter());
    this.register(new SimAdapter());
  }

  /** Register a provider adapter */
  register(adapter: WorkflowProviderAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  /** Get adapter for a given provider — falls back to CustomAdapter */
  getAdapter(provider: WorkflowProvider): WorkflowProviderAdapter {
        const adapter = this.adapters.get(provider);
    if (adapter) return adapter;

    logger.warn({
      scope: 'workflow.provider-factory',
      message: 'No workflow adapter found; falling back to custom',
      provider,
    });
    return this.adapters.get('custom')!;
  }

  /** Check if a dedicated adapter exists for the provider */
  hasAdapter(provider: WorkflowProvider): boolean {
    return this.adapters.has(provider);
  }

  /** List all registered provider names */
  listProviders(): WorkflowProvider[] {
    return Array.from(this.adapters.keys());
  }
}

/** Singleton registry instance */
export const WorkflowProviderFactory = new WorkflowProviderRegistry();
