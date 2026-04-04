/**
 * @fileoverview middleware/security-headers.middleware.
 *
 * Security header policy middleware for HTTP responses.
 */
import type { Request, Response, NextFunction } from "express";
import { getRuntimeConfig } from "../config/runtime.config";

/**
 * Applies baseline browser security headers and optional cross-origin isolation headers.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
    const isProd = process.env.NODE_ENV === "production";
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  if (getRuntimeConfig().features.crossOriginIsolation) {
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  if (isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
}
