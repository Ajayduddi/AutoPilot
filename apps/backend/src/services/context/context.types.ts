/**
 * @fileoverview apps/backend/src/services/context/context.types.ts
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import type { ContextCategory } from "../../repositories/context.repo";

/**
 * Lightweight thread memory insight item returned to UI/admin surfaces.
 *
 * @remarks
 * This projection intentionally trims raw context payloads to preview-safe
 * fields so clients can render summaries without loading full context bodies.
 */
export type ThreadMemoryInsight = {
  id: string;
  category: ContextCategory;
  summary: string | null;
  contentPreview: string;
  hasEmbedding: boolean;
  summaryKind?: string;
  importance?: string;
  entityKeys: string[];
  createdAt: Date;
};

/**
 * Query options for thread memory insight listing.
 */
export type ThreadMemoryInsightOptions = {
  limit?: number;
  category?: ContextCategory | "all";
  groupBy?: "none" | "category";
};

/**
 * Aggregate response payload for thread memory insights.
 */
export type ThreadMemoryInsightSummary = {
  items: ThreadMemoryInsight[];
  groupedCounts: Record<ContextCategory, number>;
  total: number;
};
