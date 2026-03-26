import type {
  Workflow,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  ProviderCapabilities,
  WorkflowProvider,
} from '@chat-automation/shared';
import { PROVIDER_CAPABILITIES } from '@chat-automation/shared';
import { BaseWebhookAdapter } from './base.adapter';
import type { WorkflowProviderAdapter } from './provider.interface';
import type { NormalizedProviderResult, ValidationResult } from './types';

// ─────────────────────────────────────────────────────────────
//  Zapier Provider Adapter
// ─────────────────────────────────────────────────────────────
//
//  Zapier workflows are triggered via Catch Hook or Webhook URLs.
//  Zapier returns a minimal acknowledgment synchronously
//  (typically `{ status: "success", id: "..." }`).
//
//  v1 limitations:
//  - No async callback support (Zapier does not POST back by default)
//  - No run inspection API
//  - No health check
// ─────────────────────────────────────────────────────────────

export class ZapierAdapter extends BaseWebhookAdapter implements WorkflowProviderAdapter {
  readonly name: WorkflowProvider = 'zapier';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.zapier;

  async validateConfig(workflow: Workflow): Promise<ValidationResult> {
    const base = await super.validateConfig(workflow);

    if (workflow.executionEndpoint && !workflow.executionEndpoint.includes('hooks.zapier.com')) {
      base.warnings.push('Zapier endpoint does not appear to be a hooks.zapier.com URL — verify it is correct');
    }

    return base;
  }

  async triggerWorkflow(
    workflow: Workflow,
    request: WorkflowExecutionRequest,
  ): Promise<WorkflowExecutionResult> {
    const endpoint = workflow.executionEndpoint!;
    const startedAt = new Date().toISOString();

    // Zapier expects a flat JSON body; we nest our metadata in a _meta key
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
        provider: 'zapier',
        // Zapier acks but runs async — we mark as running if no result data
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
        provider: 'zapier',
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
   * Zapier webhook responses are typically:
   * - { "status": "success", "attempt": "...", "id": "...", "request_id": "..." }
   * - Or minimal { "status": "success" }
   *
   * Since Zapier runs the Zap asynchronously, we treat a success ack as "running"
   * unless we detect actual result data.
   */
  normalizeResponse(raw: unknown, _workflow: Workflow): NormalizedProviderResult {
    const rawObj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

    const isAck = rawObj.status === 'success' && !rawObj.data && !rawObj.result;

    return {
      status: isAck ? 'running' : 'completed',
      result: {
        summary: isAck
          ? 'Zap triggered — running asynchronously'
          : typeof rawObj.message === 'string'
            ? rawObj.message
            : 'Zapier workflow completed',
        data: rawObj,
        items: [],
      },
      raw: rawObj,
      providerRunId: typeof rawObj.id === 'string' ? rawObj.id
        : typeof rawObj.request_id === 'string' ? rawObj.request_id
        : null,
    };
  }
}
