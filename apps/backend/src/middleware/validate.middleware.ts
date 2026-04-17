/**
 * @fileoverview middleware/validate.middleware.
 *
 * High-level purpose:
 * Cross-cutting HTTP middleware for security, validation, tracing, and request policy enforcement.
 *
 * Key Features (and trade-offs):
 * - Composes request guards before handlers execute.
 * - Standardizes auth, CSRF, headers, and error boundaries.
 * - Provides reusable policy units across API routes.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Mount middleware in bootstrap with explicit ordering.
 * 3. Keep middleware focused on request/response concerns.
 * 4. Regression-test security-sensitive changes.
 * 5. Keep documentation aligned with behavior and tests.
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
  async (req: Request, _res: Response, next: NextFunction) => {
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
