/**
 * @fileoverview schemas/workflow.schema.
 *
 * Zod schemas that define and validate API request contracts.
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
//  Shared value sets
// ─────────────────────────────────────────────────────────────

/** Supported workflow provider identifiers. */
const providerEnum = z.enum(['n8n', 'zapier', 'make', 'sim', 'custom']);
/** Allowed workflow visibility modes. */
const visibilityEnum = z.enum(['public', 'private']);
/** Supported trigger entrypoints for workflow execution. */
const triggerMethodEnum = z.enum(['webhook', 'api', 'internal']);
/** Supported authentication strategies for outbound workflow calls. */
const authTypeEnum = z.enum(['none', 'bearer', 'api_key', 'header_secret', 'custom']);
/** Actor/source labels for manual or automated trigger events. */
const triggerSourceEnum = z.enum(['ui', 'chat', 'assistant_action', 'api', 'system']);

// ─────────────────────────────────────────────────────────────
//  Workflow Create
// ─────────────────────────────────────────────────────────────

/** Validates request body for workflow creation endpoint. */
export const createWorkflowSchema = z.object({
  body: z.object({
    key: z.string().min(1, 'Workflow key is required').max(128),
    name: z.string().min(1, 'Workflow name is required').max(256),
    description: z.string().max(2000).optional(),
    provider: providerEnum.default('n8n'),
    visibility: visibilityEnum.default('public'),
    ownerUserId: z.string().optional(),
    enabled: z.boolean().default(true),
    requiresApproval: z.boolean().default(false),
    triggerMethod: triggerMethodEnum.default('webhook'),
    executionEndpoint: z.string().url('Must be a valid URL').optional(),
    httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    authType: authTypeEnum.default('none'),
    authConfig: z.record(z.string(), z.any()).optional(),
    inputSchema: z.record(z.string(), z.any()).optional(),
    outputSchema: z.record(z.string(), z.any()).optional(),
    tags: z.array(z.string()).default([]),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
});

// ─────────────────────────────────────────────────────────────
//  Workflow Update
// ─────────────────────────────────────────────────────────────

/** Validates request body for workflow update endpoint. */
export const updateWorkflowSchema = z.object({
  body: z.object({
    key: z.string().min(1).max(128).optional(),
    name: z.string().min(1).max(256).optional(),
    description: z.string().max(2000).nullable().optional(),
    provider: providerEnum.optional(),
    visibility: visibilityEnum.optional(),
    enabled: z.boolean().optional(),
    archived: z.boolean().optional(),
    requiresApproval: z.boolean().optional(),
    triggerMethod: triggerMethodEnum.optional(),
    executionEndpoint: z.string().url().nullable().optional(),
    httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    authType: authTypeEnum.optional(),
    authConfig: z.record(z.string(), z.any()).nullable().optional(),
    inputSchema: z.record(z.string(), z.any()).nullable().optional(),
    outputSchema: z.record(z.string(), z.any()).nullable().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.any()).nullable().optional(),
    version: z.number().int().positive().optional(),
  }).refine(obj => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided for update',
  }),
});

// ─────────────────────────────────────────────────────────────
//  Workflow Trigger
// ─────────────────────────────────────────────────────────────

/** Validates request body for manual workflow trigger endpoint. */
export const triggerWorkflowSchema = z.object({
  body: z.object({
    source: triggerSourceEnum.default('api'),
    input: z.record(z.string(), z.any()).default({}),
    meta: z.record(z.string(), z.any()).optional(),
  }),
});

// ─────────────────────────────────────────────────────────────
//  Test connection
// ─────────────────────────────────────────────────────────────

/** Validates request body for provider connection test endpoint. */
export const testConnectionSchema = z.object({
  body: z.object({
    executionEndpoint: z.string().url('Must be a valid URL'),
    authType: authTypeEnum.optional(),
    authConfig: z.record(z.string(), z.any()).optional(),
  }),
});
