/**
 * @fileoverview providers/workflow/n8n.adapter.
 *
 * High-level purpose:
 * Concrete workflow adapter for n8n API integration, including workflow CRUD,
 * execution triggering, and node-level operation handling.
 * Business value: enables production orchestration against n8n automations
 * with consistent backend contracts and execution telemetry.
 * System impact: primary workflow backend path in environments configured for
 * n8n-based process automation.
 *
 * Key Features (and trade-offs):
 * - Token-based API client initialization with endpoint normalization.
 * - Workflow creation/update/activation and execution helpers.
 * - Node-level operation result mapping to shared contracts.
 * - Rich metadata propagation for execution IDs and operation context.
 * - Trade-off: strong dependency on n8n API semantics and version behavior.
 *
 * Usage Guide:
 * 1. Configure n8n endpoint and credentials in provider settings.
 * 2. Resolve adapter via workflow factory.
 * 3. Call adapter methods for workflow lifecycle and node operations.
 * 4. Consume normalized operation results in orchestrator services.
 * 5. Validate against target n8n instance/version in integration tests.
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
import type { NormalizedProviderResult, NormalizedProviderError, ValidationResult } from './types';

// ─────────────────────────────────────────────────────────────
//  n8n Provider Adapter
// ─────────────────────────────────────────────────────────────
//
//  n8n workflows are triggered via webhook URLs.
//  n8n supports synchronous responses (data returned in the HTTP response)
//  and asynchronous callbacks (POST back to our /api/webhooks/n8n endpoint).
//
//  This adapter handles direct n8n webhook execution and normalization.
// ─────────────────────────────────────────────────────────────

/**
 * Workflow adapter for n8n webhook executions with n8n-specific normalization.
 *
 * @example
 * ```typescript
 * const adapter = new N8nAdapter();
 * const result = await adapter.triggerWorkflow(workflow, request);
 * ```
 */
export class N8nAdapter extends BaseWebhookAdapter implements WorkflowProviderAdapter {
    readonly name: WorkflowProvider = 'n8n';
    readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.n8n;

    async validateConfig(workflow: Workflow): Promise<ValidationResult> {
        const base = await super.validateConfig(workflow);

    // n8n webhook URLs typically contain /webhook/ or /webhook-test/
    if (workflow.executionEndpoint && !workflow.executionEndpoint.includes('webhook')) {
      base.warnings.push('n8n endpoint URL does not contain /webhook/ — verify it is correct');
    }

    return base;
  }

  async triggerWorkflow(
    workflow: Workflow,
    request: WorkflowExecutionRequest,
  ): Promise<WorkflowExecutionResult> {
        const endpoint = workflow.executionEndpoint!;
        const startedAt = new Date().toISOString();

    // Build n8n-style payload with _meta envelope
        const payload = {
      ...request.input,
      _meta: {
        runId: request.traceId,
        workflowKey: request.workflowKey,
        userId: request.userId,
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
            _runId: request.traceId,
            _workflowKey: request.workflowKey,
            _userId: request.userId,
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

      // n8n may return data synchronously
            const normalized = this.normalizeResponse(data, workflow);

      return {
        runId: request.traceId,
        workflowKey: request.workflowKey,
        provider: 'n8n',
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
        provider: 'n8n',
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
   * n8n-specific error normalization with actionable diagnostics.
   */
  normalizeError(error: unknown, workflow: Workflow): NormalizedProviderError {
        const base = super.normalizeError(error, workflow);
        const httpStatus = (error as any)?.httpStatus as number | undefined;
        const requestUrl = (error as any)?.requestUrl as string | undefined;

    // Build diagnostic hints based on HTTP status code
        const hints: string[] = [];

    if (httpStatus === 404) {
      hints.push('The n8n webhook URL returned 404 (Not Found).');
      if (requestUrl?.includes('webhook-test')) {
        hints.push(
          'The URL contains "/webhook-test/" which only works while the n8n editor is open and listening. ' +
          'Switch to the production URL using "/webhook/" instead.'
        );
      } else {
        hints.push('Ensure the n8n workflow is activated (toggled ON in n8n UI) — production webhook URLs only respond when the workflow is active.');
        hints.push('Verify the webhook path matches the path configured in the n8n Webhook node.');
      }
    } else if (httpStatus === 401 || httpStatus === 403) {
      hints.push('n8n rejected the request due to authentication/authorization. Check your auth configuration.');
    } else if (httpStatus && httpStatus >= 500) {
      hints.push('n8n returned a server error. Check the n8n execution logs for details.');
    }

    if (requestUrl) {
      hints.push(`Attempted URL: ${requestUrl}`);
    }

    if (hints.length > 0) {
      base.error.details = {
        ...((base.error.details && typeof base.error.details === 'object') ? base.error.details : {}),
        hints,
      };
      // Prepend the first hint to the error message for immediate visibility
      base.error.message = `${base.error.message} — ${hints[0]}`;
    }

    return base;
  }

  /**
   * n8n responses can be:
   * - Simple JSON objects
   * - Arrays of execution items
   * - Objects with a `data` field containing items
   */
  normalizeResponse(raw: unknown, _workflow: Workflow): NormalizedProviderResult {
        const rawObj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

    // n8n often returns arrays or { data: [...] } shapes
        let items: unknown[] = [];
    if (Array.isArray(raw)) {
      items = raw;
    } else if (Array.isArray(rawObj.data)) {
      items = rawObj.data;
    } else if (Array.isArray(rawObj.items)) {
      items = rawObj.items;
    }

    // Check if n8n signals that execution is still running (async mode)
        const isAsync = rawObj.executionId && !rawObj.finished;

    return {
      status: isAsync ? 'running' : 'completed',
      result: {
                summary: typeof rawObj.message === 'string'
          ? rawObj.message
          : items.length > 0
            ? `Returned ${items.length} item(s)`
            : 'Workflow completed',
        data: rawObj,
        items,
      },
      raw: rawObj,
            providerRunId: typeof rawObj.executionId === 'string'
        ? rawObj.executionId
        : typeof rawObj.id === 'string'
          ? rawObj.id
          : null,
    };
  }
}
