/**
 * @fileoverview providers/workflow/custom.adapter.
 *
 * High-level purpose:
 * Generic HTTP/webhook workflow adapter for integrating bespoke automation
 * systems that do not fit predefined provider adapters.
 * Business value: unlocks extensibility for enterprise-specific workflow
 * engines while preserving backend contract uniformity.
 * System impact: compatibility bridge for custom or legacy automation stacks.
 *
 * Key Features (and trade-offs):
 * - Config-driven endpoint and auth handling.
 * - Flexible payload forwarding for create/execute/list operations.
 * - Normalized response envelopes mapped to shared workflow contracts.
 * - Pluggable request shaping for provider-specific expectations.
 * - Trade-off: weaker compile-time guarantees due to generic integration
 *   semantics across diverse external systems.
 *
 * Usage Guide:
 * 1. Register custom provider config with endpoint + auth metadata.
 * 2. Resolve through `WorkflowProviderFactory`.
 * 3. Send contract-compliant operation payloads.
 * 4. Validate remote response mapping and error propagation.
 * 5. Add adapter-specific tests for request/response transformation.
 */
import {
  Workflow,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  ProviderCapabilities,
  WorkflowProvider,
} from '@autopilot/shared';
import { PROVIDER_CAPABILITIES } from '@autopilot/shared';
import { BaseWebhookAdapter } from './base.adapter';
import type { WorkflowProviderAdapter } from './provider.interface';

// ─────────────────────────────────────────────────────────────
//  Custom Webhook Provider Adapter
// ─────────────────────────────────────────────────────────────
//
//  Generic adapter for any HTTP webhook-based workflow.
//  Supports configurable auth via workflow.authType/authConfig.
//  Can receive async callbacks via /api/webhooks/callback.
//
//  This is the fallback adapter — any provider without a
//  dedicated adapter can use this.
// ─────────────────────────────────────────────────────────────

/**
 * Generic webhook workflow adapter used as the provider fallback.
 *
 * @remarks
 * This adapter supports all configured HTTP methods and normalizes responses
 * into the shared workflow execution result contract.
 *
 * @example
 * ```typescript
 * const adapter = new CustomAdapter();
 * const result = await adapter.triggerWorkflow(workflow, request);
 * ```
 */
export class CustomAdapter extends BaseWebhookAdapter implements WorkflowProviderAdapter {
    readonly name: WorkflowProvider = 'custom';
    readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.custom;

  async triggerWorkflow(
    workflow: Workflow,
    request: WorkflowExecutionRequest,
  ): Promise<WorkflowExecutionResult> {
        const endpoint = workflow.executionEndpoint!;
        const startedAt = new Date().toISOString();

        const payload = {
      ...request.input,
      _meta: {
        traceId: request.traceId,
        workflowKey: request.workflowKey,
        userId: request.userId,
        source: request.source,
        callbackUrl: request.callbackUrl,
      },
    };

        const authHeaders = this.buildAuthHeaders(workflow);

    try {
            let data: unknown;
            const headers = { ...authHeaders, 'x-trace-id': request.traceId };

      switch (workflow.httpMethod) {
        case 'GET': {
                    const queryParams = {
            ...request.input,
            _traceId: request.traceId,
            _workflowKey: request.workflowKey,
            _userId: request.userId,
            _source: request.source,
            _callbackUrl: request.callbackUrl,
          };
          ({ data } = await this.httpGet(endpoint, headers, queryParams));
          break;
        }
        case 'PUT':
          ({ data } = await this.httpPut(endpoint, payload, headers));
          break;
        case 'PATCH':
          ({ data } = await this.httpPatch(endpoint, payload, headers));
          break;
        case 'DELETE':
          ({ data } = await this.httpDelete(endpoint, payload, headers));
          break;
        case 'POST':
        default:
          ({ data } = await this.httpPost(endpoint, payload, headers));
          break;
      }

            const normalized = this.normalizeResponse(data, workflow);

      return {
        runId: request.traceId,
        workflowKey: request.workflowKey,
        provider: this.name,
        status: normalized.status,
        result: normalized.result,
        raw: normalized.raw,
        error: null,
        meta: {
          startedAt,
                    finishedAt: normalized.status === 'completed' ? new Date().toISOString() : null,
          triggerSource: request.source,
          providerRunId: normalized.providerRunId,
        },
      };
    } catch (err) {
            const normalized = this.normalizeError(err, workflow);
      return {
        runId: request.traceId,
        workflowKey: request.workflowKey,
        provider: this.name,
        status: 'failed',
        result: null,
        raw: null,
        error: normalized.error as any,
        meta: {
          startedAt,
          finishedAt: new Date().toISOString(),
          triggerSource: request.source,
          providerRunId: null,
        },
      };
    }
  }
}
