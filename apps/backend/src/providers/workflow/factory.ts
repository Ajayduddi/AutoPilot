/**
 * @fileoverview providers/workflow/factory.
 *
 * External provider adapters and interfaces for LLMs and workflow engines.
 */
import type { WorkflowProvider } from '@autopilot/shared';
import type { WorkflowProviderAdapter } from './provider.interface';
import { N8nAdapter } from './n8n.adapter';
import { ZapierAdapter } from './zapier.adapter';
import { MakeAdapter } from './make.adapter';
import { CustomAdapter } from './custom.adapter';
import { SimAdapter } from './sim.adapter';

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

    console.warn(`[WorkflowProviderFactory] No adapter for "${provider}", falling back to custom`);
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
