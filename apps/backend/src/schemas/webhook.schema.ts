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
    traceId: z.string(),
    workflowKey: z.string(),
    provider: z.enum(['n8n', 'zapier', 'make', 'sim', 'custom']),
    status: z.enum(['running', 'completed', 'failed', 'waiting_approval']),
    result: z.record(z.string(), z.any()).nullable().optional(),
    raw: z.record(z.string(), z.any()).nullable().optional(),
    error: z.record(z.string(), z.any()).nullable().optional(),
    meta: z.record(z.string(), z.any()).optional(),
  }),
});
