/**
 * @fileoverview apps/backend/src/services/context/context-workflow-cache.service.ts
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
import { getRuntimeConfig } from "../../config/runtime.config";
import { type ContextItem } from "../../repositories/context.repo";
import { WorkflowRepo } from "../../repositories/workflow.repo";
import { logger } from "../../util/logger";

declare const Bun: {
  write(path: string, data: string): Promise<number>;
  file(path: string): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
  };
};

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const value = String(part || "");
      if (index === 0) return value.replace(/\/+$/, "");
      return value.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean)
    .join("/");
}

function estimateTokens(text: string): number {
  return Math.ceil(String(text || "").length / 4);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function recursiveLookup(value: unknown, targetKey: string, matches: unknown[], depth = 0): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) recursiveLookup(item, targetKey, matches, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (normalizeText(key) === targetKey) matches.push(child);
    recursiveLookup(child, targetKey, matches, depth + 1);
  }
}

function serializeSnapshotValue(label: string, value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return `${label}:\nnull`;
  if (typeof value === "string") return `${label}:\n${value}`;
  try {
    return `${label}:\n${JSON.stringify(value, null, 2)}`;
  } catch {
    return `${label}:\n${String(value)}`;
  }
}

async function ensureWorkflowCacheDir(): Promise<string> {
  const dir = joinPath(getRuntimeConfig().homeDir, "workflow-cache");
  await Bun.write(joinPath(dir, ".keep"), "");
  return dir;
}

export function buildWorkflowSnapshotText(input: {
  workflowName?: string;
  workflowKey?: string;
  provider?: string;
  status?: string;
  triggerSource?: string;
  originalQuestion?: string;
  inputPayload?: unknown;
  normalizedOutput?: unknown;
  rawProviderResponse?: unknown;
  errorPayload?: unknown;
}): string {
  const sections = [
    input.workflowName || input.workflowKey
      ? `Workflow: ${input.workflowName || input.workflowKey}${input.workflowKey ? ` (${input.workflowKey})` : ""}`
      : "",
    input.provider ? `Provider: ${input.provider}` : "",
    input.status ? `Status: ${input.status}` : "",
    input.triggerSource ? `Trigger: ${input.triggerSource}` : "",
    input.originalQuestion ? `Original question: ${input.originalQuestion}` : "",
    serializeSnapshotValue("Input payload", input.inputPayload),
    serializeSnapshotValue("Normalized output", input.normalizedOutput),
    serializeSnapshotValue("Raw provider response", input.rawProviderResponse),
    serializeSnapshotValue("Error payload", input.errorPayload),
  ].filter(Boolean);
  return sections.join("\n\n").trim();
}

export class ContextWorkflowCacheService {
  static async persistWorkflowRunSnapshot(input: {
    workflowRunId: string;
    workflowKey: string;
    workflowName: string;
    provider: string;
    status: string;
    triggerSource: string;
    originalQuestion?: string;
    inputPayload?: unknown;
    normalizedOutput?: unknown;
    rawProviderResponse?: unknown;
    errorPayload?: unknown;
  }): Promise<{ path: string; bytes: number; tokenEstimate: number }> {
    const text = buildWorkflowSnapshotText(input);
    const cacheDir = await ensureWorkflowCacheDir();
    const snapshotPath = joinPath(cacheDir, `${input.workflowRunId}.txt`);
    await Bun.write(snapshotPath, text);
    const bytes = new TextEncoder().encode(text).byteLength;
    return {
      path: snapshotPath,
      bytes,
      tokenEstimate: estimateTokens(text),
    };
  }

  static async loadCompleteWorkflowCache(item: ContextItem): Promise<string> {
    const meta = (item.metadata as Record<string, unknown> | null) || {};
    const snapshotPath = typeof meta.snapshotPath === "string" ? meta.snapshotPath : "";
    if (snapshotPath && await Bun.file(snapshotPath).exists()) {
      try {
        return await Bun.file(snapshotPath).text();
      } catch (error) {
        logger.error({
          message: "Failed to read workflow snapshot",
          scope: "context.workflow-cache",
          details: { snapshotPath, error: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    const runId = typeof meta.runId === "string" ? meta.runId : item.workflowRunId || "";
    if (runId) {
      try {
        const run = await WorkflowRepo.getRunById(runId);
        if (run) {
          return buildWorkflowSnapshotText({
            workflowName: String(meta.workflowName || meta.workflowKey || ""),
            workflowKey: String(meta.workflowKey || ""),
            provider: String(meta.provider || ""),
            status: String(meta.status || ""),
            triggerSource: String(meta.triggerSource || ""),
            originalQuestion: typeof meta.originalQuestion === "string" ? meta.originalQuestion : undefined,
            inputPayload: run.inputPayload,
            normalizedOutput: run.normalizedOutput,
            rawProviderResponse: run.rawProviderResponse,
            errorPayload: run.errorPayload,
          });
        }
      } catch (error) {
        logger.error({
          message: "Failed to hydrate workflow run",
          scope: "context.workflow-cache",
          details: { runId, error: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    return item.content;
  }

  static async extractWorkflowRunFields(
    item: ContextItem,
    fields: string[],
  ): Promise<{ values: Record<string, unknown>; missing: string[]; source: "normalized_output" | "snapshot_text" | "context_content" }> {
    const normalizedFields = [...new Set(fields.map((field) => normalizeText(field)).filter(Boolean))];
    const values: Record<string, unknown> = {};
    const missing: string[] = [];
    const meta = (item.metadata as Record<string, unknown> | null) || {};
    const runId = typeof meta.runId === "string" ? meta.runId : item.workflowRunId || "";

    if (runId) {
      try {
        const run = await WorkflowRepo.getRunById(runId);
        if (run?.normalizedOutput && typeof run.normalizedOutput === "object") {
          for (const field of normalizedFields) {
            const matches: unknown[] = [];
            recursiveLookup(run.normalizedOutput, field, matches);
            if (matches.length === 1) values[field] = matches[0];
            else if (matches.length > 1) values[field] = matches;
            else missing.push(field);
          }
          return { values, missing, source: "normalized_output" };
        }
      } catch (error) {
        logger.error({
          message: "Failed to extract workflow fields from run",
          scope: "context.workflow-cache",
          details: { runId, error: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    const fullText = await this.loadCompleteWorkflowCache(item);
    for (const field of normalizedFields) {
      const pattern = new RegExp(`${field.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*[:=]\\s*(.+)`, "i");
      const match = fullText.match(pattern);
      if (match?.[1]) values[field] = truncate(match[1].trim(), 500);
      else missing.push(field);
    }

    if (Object.keys(values).length > 0 || fullText !== item.content) {
      return { values, missing, source: "snapshot_text" };
    }

    return { values, missing, source: "context_content" };
  }
}
