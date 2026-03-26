import type { WorkflowProvider, ProviderCapabilities } from '@chat-automation/shared';
import { PROVIDER_CAPABILITIES } from '@chat-automation/shared';
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

export class SimAdapter extends CustomAdapter {
  override readonly name: WorkflowProvider = 'sim';
  override readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.sim;
}
