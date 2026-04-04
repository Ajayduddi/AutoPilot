/**
 * @fileoverview providers/workflow/sim.adapter.
 *
 * External provider adapters and interfaces for LLMs and workflow engines.
 */
import type { WorkflowProvider, ProviderCapabilities } from '@autopilot/shared';
import { PROVIDER_CAPABILITIES } from '@autopilot/shared';
import { CustomAdapter } from './custom.adapter';

// ─────────────────────────────────────────────────────────────
//  Sim Provider Adapter
// ─────────────────────────────────────────────────────────────
//
//  Sim is a custom/webhook-compatible workflow provider.
//  It extends CustomAdapter with Sim-specific defaults.
//  In v1 this is functionally identical to CustomAdapter
//  but kept separate for future Sim-specific extensions
//  (e.g. Sim-specific auth, response parsing, SDK support).
// ─────────────────────────────────────────────────────────────

/**
 * Sim provider adapter aliasing custom webhook behavior with Sim capabilities.
 *
 * @example
 * ```typescript
 * const adapter = new SimAdapter();
 * console.log(adapter.name); // "sim"
 * ```
 */
export class SimAdapter extends CustomAdapter {
    override readonly name: WorkflowProvider = 'sim';
    override readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.sim;
}
