/**
 * @fileoverview apps/backend/src/schemas/search.schema.ts
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

const boolish = z.union([z.boolean(), z.string()]).optional();

export const workflowSemanticSearchSchema = z.object({
  body: z.object({
    q: z.string().min(1, 'Query is required').max(500),
    limit: z.number().int().min(1).max(50).optional(),
    minScore: z.number().min(0).max(1).optional(),
    provider: z.string().min(1).optional(),
    enabled: boolish,
    archived: boolish,
    visibility: z.enum(['public', 'private']).optional(),
  }),
});

export const documentSemanticSearchSchema = z.object({
  body: z.object({
    q: z.string().min(1, 'Query is required').max(500),
    limit: z.number().int().min(1).max(50).optional(),
    minScore: z.number().min(0).max(1).optional(),
    threadId: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
  }),
});

export const runSemanticSearchSchema = z.object({
  body: z.object({
    q: z.string().min(1, 'Query is required').max(500),
    limit: z.number().int().min(1).max(50).optional(),
    minScore: z.number().min(0).max(1).optional(),
    workflowId: z.string().optional(),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'waiting_approval']).optional(),
    threadId: z.string().optional(),
    onlyFailures: boolish,
  }),
});
