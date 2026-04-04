/**
 * @fileoverview schemas/approval.schema.
 *
 * Zod schemas that define and validate API request contracts.
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

