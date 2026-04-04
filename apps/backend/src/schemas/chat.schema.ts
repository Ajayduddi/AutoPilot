/**
 * @fileoverview schemas/chat.schema.
 *
 * Zod schemas that define and validate API request contracts.
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
