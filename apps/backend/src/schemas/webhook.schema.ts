/**
 * @fileoverview schemas/webhook.schema.
 *
 * High-level purpose:
 * Request/response validation schemas that enforce API and workflow contracts.
 *
 * Key Features (and trade-offs):
 * - Typed schema definitions for endpoint payload boundaries.
 * - Consistent validation rules reused across handlers.
 * - Reduces runtime ambiguity for malformed client input.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Update schemas alongside route contract changes.
 * 3. Keep schema defaults/constraints explicit.
 * 4. Add tests for new boundary and invalid-input cases.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { z } from 'zod';

/** n8n-specific callback schema (backward-compatible) */
export const n8nCallbackSchema = z.object({
  body: z.object({
    type: z.enum(['completed', 'error']),
    runId: z.string(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
});

/** Unified provider callback schema */
export const unifiedCallbackSchema = z.object({
  body: z.object({
    traceId: z.string().optional(),
    workflowKey: z.string(),
    provider: z.enum(['n8n', 'zapier', 'make', 'sim', 'custom']),
    status: z.enum(['running', 'completed', 'failed', 'waiting_approval']),
    result: z.record(z.string(), z.any()).nullable().optional(),
    raw: z.record(z.string(), z.any()).nullable().optional(),
    error: z.record(z.string(), z.any()).nullable().optional(),
    summary: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    nextSuggestedAction: z.string().optional(),
    planStepId: z.string().optional(),
    meta: z.record(z.string(), z.any()).optional(),
  }),
});
