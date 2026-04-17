/**
 * @fileoverview schemas/approval.schema.
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

/**
 * createApprovalSchema exported constant.
 */
export const createApprovalSchema = z.object({
  body: z.object({
    runId: z.string().trim().min(1, 'runId is required'),
    userId: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1, 'summary is required').max(500),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

