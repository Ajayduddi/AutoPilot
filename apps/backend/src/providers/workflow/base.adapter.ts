/**
 * @fileoverview providers/workflow/base.adapter.
 *
 * External provider adapters and interfaces for LLMs and workflow engines.
 */
import type { Workflow, WorkflowExecutionRequest, WorkflowExecutionResult } from '@autopilot/shared';
import type { WorkflowProviderAdapter } from './provider.interface';
import type {
  NormalizedProviderResult,
  NormalizedProviderError,
  ValidationResult,
  HealthCheckResult,
} from './types';
import { assertSafeOutboundUrl } from '../../util/network-safety';

// ─────────────────────────────────────────────────────────────
//  Base Webhook Adapter
// ─────────────────────────────────────────────────────────────
//
//  Shared logic for HTTP-webhook-based providers.
//  Concrete adapters extend this and can override any method.
// ─────────────────────────────────────────────────────────────

/**
 * BaseWebhookAdapter class.
 */
export abstract class BaseWebhookAdapter implements Pick<
  WorkflowProviderAdapter,
  'validateConfig' | 'triggerWorkflow' | 'normalizeResponse' | 'normalizeError'
> {

  abstract triggerWorkflow(
    workflow: Workflow,
    request: WorkflowExecutionRequest,
  ): Promise<WorkflowExecutionResult>;

  // ── Auth header construction ────────────────────────────────

  /**
   * Build auth headers from the workflow's authType + authConfig.
   * Override in subclass if the provider needs special handling.
   */
  protected buildAuthHeaders(workflow: Workflow): Record<string, string> {
        const headers: Record<string, string> = {};

    switch (workflow.authType) {
      case 'bearer': {
                const token = this.resolveSecret(workflow.authConfig, 'token', 'tokenRef');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        break;
      }
      case 'api_key': {
                const key = this.resolveSecret(workflow.authConfig, 'apiKey', 'apiKeyRef');
                const headerName = (workflow.authConfig?.headerName as string) || 'X-API-Key';
        if (key) headers[headerName] = key;
        break;
      }
      case 'header_secret': {
                const secret = this.resolveSecret(workflow.authConfig, 'secret', 'secretRef');
                const headerName = (workflow.authConfig?.headerName as string) || 'X-Webhook-Secret';
        if (secret) headers[headerName] = secret;
        break;
      }
      case 'custom': {
        // Custom auth: merge all headers from authConfig.headers
                const customHeaders = workflow.authConfig?.headers as Record<string, string> | undefined;
        if (customHeaders) Object.assign(headers, customHeaders);
        break;
      }
      // 'none' — no auth headers
    }
    return headers;
  }

  /**
   * Resolve a secret value. In v1 this reads from env vars via the `*Ref` field.
   * In the future this can be extended to read from a vault.
   */
  protected resolveSecret(
    config: Record<string, unknown> | null | undefined,
    directKey: string,
    refKey: string,
  ): string | null {
    if (!config) return null;
    // Direct value (for dev/testing — not recommended in production)
    if (typeof config[directKey] === 'string') return config[directKey] as string;
    // Environment variable reference
    if (typeof config[refKey] === 'string') {
      return process.env[config[refKey] as string] ?? null;
    }
    return null;
  }

  // ── Retry logic for transient gateway errors ─────────────────

  private static readonly RETRYABLE_STATUSES = new Set([502, 503, 504]);
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAYS = [1000, 2000, 4000]; // ms

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<{ status: number; data: unknown; raw: string }> {
        const safeUrl = assertSafeOutboundUrl(url, {
      allowPrivateLocalInDev: true,
      requireHttpsInProd: true,
    }).toString();
        let lastError: Error | undefined;

    for (let attempt = 0; attempt <= BaseWebhookAdapter.MAX_RETRIES; attempt++) {
      if (attempt > 0) {
                const delay = BaseWebhookAdapter.RETRY_DELAYS[attempt - 1] ?? 4000;
        console.log(`[WebhookAdapter] Retry ${attempt}/${BaseWebhookAdapter.MAX_RETRIES} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }

      console.log(`[WebhookAdapter] ${init.method} → ${safeUrl}`);
            const response = await fetch(safeUrl, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

            const rawText = await response.text();
      console.log(`[WebhookAdapter] Response: ${response.status} ${response.statusText}`);

            let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { rawText };
      }

      // Retry on transient gateway errors
      if (BaseWebhookAdapter.RETRYABLE_STATUSES.has(response.status)) {
        lastError = Object.assign(new Error(`Provider responded with HTTP ${response.status}`), {
          httpStatus: response.status,
          responseBody: data,
          requestUrl: safeUrl,
        });
        continue;
      }

      if (!response.ok) {
        throw Object.assign(new Error(`Provider responded with HTTP ${response.status}`), {
          httpStatus: response.status,
          responseBody: data,
          requestUrl: safeUrl,
        });
      }

      return { status: response.status, data, raw: rawText };
    }

    // All retries exhausted
    throw lastError!;
  }

  // ── HTTP dispatch ───────────────────────────────────────────

  /**
   * Execute an HTTP POST to the workflow's endpoint.
   * Subclasses can override to customise body shape, method, etc.
   */
  protected async httpPost(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    timeoutMs = 30_000,
  ): Promise<{ status: number; data: unknown; raw: string }> {
    return this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }, timeoutMs);
  }

  /**
   * Execute an HTTP GET to the workflow's endpoint.
   */
  protected async httpGet(
    url: string,
    headers: Record<string, string>,
    queryParams?: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<{ status: number; data: unknown; raw: string }> {
        const targetUrl = new URL(url);
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null) targetUrl.searchParams.set(k, String(v));
      }
    }
    return this.fetchWithRetry(targetUrl.toString(), {
      method: 'GET',
      headers,
    }, timeoutMs);
  }

  /**
   * Execute an HTTP PUT to the workflow's endpoint.
   */
  protected async httpPut(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    timeoutMs = 30_000,
  ): Promise<{ status: number; data: unknown; raw: string }> {
    return this.fetchWithRetry(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }, timeoutMs);
  }

  /**
   * Execute an HTTP PATCH to the workflow's endpoint.
   */
  protected async httpPatch(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    timeoutMs = 30_000,
  ): Promise<{ status: number; data: unknown; raw: string }> {
    return this.fetchWithRetry(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }, timeoutMs);
  }

  /**
   * Execute an HTTP DELETE to the workflow's endpoint.
   */
  protected async httpDelete(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    timeoutMs = 30_000,
  ): Promise<{ status: number; data: unknown; raw: string }> {
    return this.fetchWithRetry(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }, timeoutMs);
  }

  // ── Validation helpers ──────────────────────────────────────

    async validateConfig(workflow: Workflow): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

    if (!workflow.executionEndpoint) {
      errors.push('Execution endpoint URL is required');
    } else {
      try {
        assertSafeOutboundUrl(workflow.executionEndpoint, {
          allowPrivateLocalInDev: true,
          requireHttpsInProd: true,
        });
      } catch {
        errors.push('Execution endpoint is invalid or blocked by outbound URL policy');
      }
    }

    if (workflow.authType !== 'none' && !workflow.authConfig) {
      warnings.push(`Auth type is ${workflow.authType} but no auth config is provided`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ── Normalization ───────────────────────────────────────────

    normalizeResponse(raw: unknown, _workflow: Workflow): NormalizedProviderResult {
        const rawObj = (typeof raw === 'object' && raw !== null ? raw : { value: raw }) as Record<string, unknown>;
    return {
      status: 'completed',
      result: {
                summary: typeof rawObj.message === 'string' ? rawObj.message : 'Workflow completed',
        data: rawObj,
        items: Array.isArray(rawObj.items) ? rawObj.items : [],
      },
      raw: rawObj,
            providerRunId: typeof rawObj.runId === 'string' ? rawObj.runId
        : typeof rawObj.id === 'string' ? rawObj.id
        : null,
    };
  }

    normalizeError(error: unknown, _workflow: Workflow): NormalizedProviderError {
        const errObj = error as Record<string, unknown> | Error;
        const message = errObj instanceof Error ? errObj.message : String(errObj);
        const code = (errObj as any)?.httpStatus ? String((errObj as any).httpStatus) : null;
        const details = (errObj as any)?.responseBody ?? null;

    return {
      status: 'failed',
      error: { message, code, details },
      raw: errObj instanceof Error ? { message: errObj.message, stack: errObj.stack } : (errObj as any),
    };
  }

  // ── Health check ────────────────────────────────────────────

    async healthCheck(workflow: Workflow): Promise<HealthCheckResult> {
    if (!workflow.executionEndpoint) {
      return { healthy: false, latencyMs: 0, message: 'No execution endpoint configured' };
    }
        const start = Date.now();
    try {
            const endpoint = assertSafeOutboundUrl(workflow.executionEndpoint, {
        allowPrivateLocalInDev: true,
        requireHttpsInProd: true,
      });
            const res = await fetch(endpoint.toString(), {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
      });
      return {
        healthy: res.ok || res.status < 500,
        latencyMs: Date.now() - start,
        message: `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
