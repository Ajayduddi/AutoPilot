/**
 * @fileoverview middleware/validate.middleware.
 *
 * Cross-cutting HTTP middleware for security, auth, tracing, and input handling.
 */
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Builds an Express middleware that validates request payload parts using Zod.
 *
 * @param schema - Zod schema validating `{ body, query, params }`.
 * @returns Async Express middleware that forwards parsed validation errors to error handlers.
 *
 * @remarks
 * Validation uses `parseAsync` to support asynchronous refinements.
 *
 * @example
 * ```typescript
 * app.post("/api/items", validate(createItemSchema), handler);
 * ```
 */
export const validate = (schema: ZodSchema) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      return next();
    } catch (error) {
      return next(error);
    }
  };
