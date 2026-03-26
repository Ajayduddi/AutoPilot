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
