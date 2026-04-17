/**
 * @fileoverview providers/workflow/sim.adapter.
 *
 * High-level purpose:
 * Deterministic simulation adapter used for local development, test fixtures,
 * and fallback execution when external providers are unavailable.
 * Business value: improves reliability of CI and local workflows by removing
 * dependency on third-party provider uptime.
 * System impact: non-production-safe provider path for controlled validation.
 *
 * Key Features (and trade-offs):
 * - Predictable operation responses for create/execute/list calls.
 * - Fast execution without network round trips.
 * - Rich fake metadata for debugging orchestration behavior.
 * - Suitable for contract and failure-path testing.
 * - Trade-off: does not represent full real-provider behavior or edge cases.
 *
 * Usage Guide:
 * 1. Select provider type `sim` in workflow provider settings.
 * 2. Use adapter in tests/local development scenarios.
 * 3. Assert orchestration behavior against deterministic outputs.
 * 4. Do not rely on this adapter for production execution semantics.
 * 5. Pair with integration tests against real providers before release.
 */
import type { ProviderCapabilities, WorkflowProvider } from '@autopilot/shared';
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
