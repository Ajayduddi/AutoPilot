/**
 * @fileoverview providers/workflow/make.adapter.
 *
 * External provider adapters and interfaces for LLMs and workflow engines.
 */
import type {
  Workflow,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  ProviderCapabilities,
  WorkflowProvider,
} from '@autopilot/shared';
import { PROVIDER_CAPABILITIES } from '@autopilot/shared';
import { BaseWebhookAdapter } from './base.adapter';
import type { WorkflowProviderAdapter } from './provider.interface';
import type { NormalizedProviderResult, ValidationResult } from './types';

// ─────────────────────────────────────────────────────────────
//  Make.com Provider Adapter
// ─────────────────────────────────────────────────────────────
//
//  Make.com scenarios can be triggered via:
//  - Webhook URL (Custom Webhook module)
//  - API endpoint for specific scenarios
//
//  Make.com returns a synchronous response for webhook triggers.
//  The response shape is typically `{ accepted: true }` for instant
//  triggers, or actual scenario output data for synchronous scenarios.
//
//  v1 limitations:
//  - No async callback support
//  - No run inspection API in v1
//  - No health check
// ─────────────────────────────────────────────────────────────

/**
 * Workflow adapter for Make.com webhook/scenario triggers.
 *
 * @example
 * ```typescript
 * const adapter = new MakeAdapter();
 * const validation = await adapter.validateConfig(workflow);
 * ```
 */
export class MakeAdapter extends BaseWebhookAdapter implements WorkflowProviderAdapter {
    readonly name: WorkflowProvider = 'make';
    readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.make;

    async validateConfig(workflow: Workflow): Promise<ValidationResult> {
        const base = await super.validateConfig(workflow);

    if (workflow.executionEndpoint) {
            const isMakeUrl = workflow.executionEndpoint.includes('make.com')
        || workflow.executionEndpoint.includes('integromat.com')
        || workflow.executionEndpoint.includes('hook.eu1.make.com')
        || workflow.executionEndpoint.includes('hook.us1.make.com');

      if (!isMakeUrl) {
        base.warnings.push('Endpoint does not appear to be a Make.com URL — verify it is correct');
      }
    }

    return base;
  }

  async triggerWorkflow(
    workflow: Workflow,
    request: WorkflowExecutionRequest,
  ): Promise<WorkflowExecutionResult> {
        const endpoint = workflow.executionEndpoint!;
        const startedAt = new Date().toISOString();

    // Make.com expects JSON body
        const payload = {
      ...request.input,
      _traceId: request.traceId,
      _workflowKey: request.workflowKey,
      _userId: request.userId,
      _source: request.source,
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
        provider: 'make',
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
        provider: 'make',
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

  /**
   * Make.com webhook responses:
   * - Instant triggers: { "accepted": true }
   * - Synchronous data: actual scenario output JSON
   *
   * We treat `accepted: true` without data as "running" (scenario is executing).
   */
  normalizeResponse(raw: unknown, _workflow: Workflow): NormalizedProviderResult {
        const rawObj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

        const isAcceptedOnly = rawObj.accepted === true
      && Object.keys(rawObj).filter(k => k !== 'accepted').length === 0;

        let items: unknown[] = [];
    if (Array.isArray(raw)) items = raw;
    else if (Array.isArray(rawObj.data)) items = rawObj.data;

    return {
      status: isAcceptedOnly ? 'running' : 'completed',
      result: {
        summary: isAcceptedOnly
          ? 'Scenario triggered — executing asynchronously'
          : typeof rawObj.message === 'string'
            ? rawObj.message
            : items.length > 0
              ? `Returned ${items.length} item(s)`
              : 'Make.com scenario completed',
        data: rawObj,
        items,
      },
      raw: rawObj,
            providerRunId: typeof rawObj.executionId === 'string' ? rawObj.executionId : null,
    };
  }
}
