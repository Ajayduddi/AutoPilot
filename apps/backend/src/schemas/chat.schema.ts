import { z } from 'zod';

export const createThreadSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').optional(),
  })
});

export const addMessageSchema = z.object({
  body: z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1, 'Message content cannot be empty'),
    providerId: z.string().optional(),
    model: z.string().optional(),
  })
});

export const renameThreadSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title cannot be empty').max(50, 'Title must be 50 characters or fewer'),
  })
});
