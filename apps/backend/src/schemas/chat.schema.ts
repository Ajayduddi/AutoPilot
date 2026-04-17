/**
 * @fileoverview schemas/chat.schema.
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
 * createThreadSchema exported constant.
 */
export const createThreadSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').optional(),
  })
});

/**
 * addMessageSchema exported constant.
 */
export const addMessageSchema = z.object({
  body: z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().optional().default(''),
    providerId: z.string().optional(),
    model: z.string().optional(),
    attachmentIds: z.array(z.string()).optional().default([]),
  }).refine((data) => {
        const hasText = !!data.content?.trim();
        const hasAttachments = !!data.attachmentIds?.length;
    return hasText || hasAttachments;
  }, { message: 'Message content cannot be empty without attachments.' })
});

/**
 * renameThreadSchema exported constant.
 */
export const renameThreadSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title cannot be empty').max(50, 'Title must be 50 characters or fewer'),
  })
});

/**
 * answerQuestionSchema exported constant.
 */
export const answerQuestionSchema = z.object({
  body: z.object({
    optionId: z.string().min(1).optional(),
    valueToSend: z.string().min(1, 'valueToSend is required'),
    providerId: z.string().optional(),
    model: z.string().optional(),
  }),
});
