/**
 * @fileoverview apps/backend/src/services/orchestrator/orchestrator-evidence.service.ts
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
import { contextConfig } from "../../config/context.config";
import { ContextService } from "../context/context.service";

function estimateTokens(value: string): number {
  const text = String(value || "");
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function truncateToTokenBudget(value: string, maxTokens: number): string {
  const text = String(value || "");
  if (!text) return "";
  const maxChars = Math.max(64, Math.floor(Math.max(1, maxTokens) * 4));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function tokenizeForWorkflowMatch(input: string): string[] {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export async function getThreadWorkflowContextWindow(threadId: string, limit = 6): Promise<any[]> {
  try {
    const items = await ContextService.getThreadContext(threadId, {
      categories: ["workflow_run"],
      limit,
    });
    return (items || []).filter((item: any) => item?.category === "workflow_run");
  } catch {
    return [];
  }
}

function scoreWorkflowContextItem(question: string, item: any): number {
  const q = String(question || "").toLowerCase();
  const meta = (item?.metadata || {}) as Record<string, unknown>;
  const workflowKey = String(meta.workflowKey || "").toLowerCase();
  const workflowName = String(meta.workflowName || "").toLowerCase();
  const content = String(item?.content || "").toLowerCase();

  let score = 0;
  if (workflowKey && q.includes(workflowKey)) score += 10;
  if (workflowName && q.includes(workflowName)) score += 10;

  const qTokens = new Set(tokenizeForWorkflowMatch(q));
  const wfTokens = new Set([
    ...tokenizeForWorkflowMatch(workflowKey.replace(/[_\-]+/g, " ")),
    ...tokenizeForWorkflowMatch(workflowName),
  ]);
  for (const token of wfTokens) {
    if (qTokens.has(token)) score += 2;
  }

  let overlap = 0;
  for (const token of qTokens) {
    if (token.length < 4) continue;
    if (content.includes(token)) overlap += 1;
  }
  score += Math.min(6, overlap);

  const createdAtMs = item?.createdAt ? new Date(item.createdAt).getTime() : 0;
  if (createdAtMs > 0) {
    const ageMins = (Date.now() - createdAtMs) / 60000;
    if (ageMins <= 15) score += 4;
    else if (ageMins <= 60) score += 2;
    else if (ageMins <= 240) score += 1;
  }
  return score;
}

export function selectThreadWorkflowWindowForQuestion(
  question: string,
  items: any[],
  options?: { maxItems?: number; maxDistinctWorkflows?: number; preferredWorkflowKey?: string },
): any[] {
  const maxItems = options?.maxItems ?? 4;
  const maxDistinct = options?.maxDistinctWorkflows ?? 3;
  const preferred = String(options?.preferredWorkflowKey || "");
  if (!items.length) return [];

  const scored = [...items]
    .map((item) => ({ item, score: scoreWorkflowContextItem(question, item) }))
    .sort((a, b) => b.score - a.score);

  const picked: any[] = [];
  const byWorkflow = new Set<string>();

  if (preferred) {
    const preferredItem = scored.find(({ item }) => {
      const key = String(((item?.metadata || {}) as Record<string, unknown>).workflowKey || "");
      return key === preferred;
    });
    if (preferredItem) {
      picked.push(preferredItem.item);
      byWorkflow.add(preferred);
    }
  }

  for (const { item } of scored) {
    if (picked.length >= maxItems) break;
    const key = String((((item?.metadata || {}) as Record<string, unknown>).workflowKey) || "");
    const isNewWorkflow = key && !byWorkflow.has(key);
    if (isNewWorkflow && byWorkflow.size >= maxDistinct) continue;
    if (!picked.includes(item)) picked.push(item);
    if (key) byWorkflow.add(key);
  }

  return picked.slice(0, maxItems);
}

function isDetailHeavyFollowUpQuestion(question: string): boolean {
  const q = String(question || "").toLowerCase();
  if (!q) return false;
  if (/(which|where|who|company|email|location|exact|details?|list|all|history|experience)/.test(q)) return true;
  if (/(count|sum|average|avg|min|max|greater than|less than|between|filter)/.test(q)) return true;
  return q.length > 110;
}

function inferRequestedFieldHints(question: string): string[] {
  const q = String(question || "").toLowerCase();
  const fields = new Set<string>();
  const fieldMatchers: Array<[string, RegExp]> = [
    ["name", /\bname\b/],
    ["email", /\bemail\b/],
    ["location", /\blocation|where\b/],
    ["phone", /\bphone|mobile|contact\b/],
    ["education", /\beducation|degree|college|university|graduation|gpa\b/],
    ["graduation", /\bgraduation|graduate|passed out\b/],
    ["experience", /\bexperience|work|job|employment\b/],
    ["company", /\bcompany|organization|worked at\b/],
    ["role", /\brole|position|title\b/],
    ["duration", /\bduration|tenure|how long\b/],
    ["description", /\bdescription|responsibilit|about\b/],
    ["project", /\bproject\b/],
    ["skills", /\bskills|tech stack|technologies\b/],
    ["linkedin", /\blinkedin\b/],
    ["github", /\bgithub\b/],
    ["portfolio", /\bportfolio\b/],
  ];
  for (const [field, pattern] of fieldMatchers) {
    if (pattern.test(q)) fields.add(field);
  }
  return [...fields].slice(0, 8);
}

function collectWorkflowKeys(items: any[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const key = String((((item?.metadata || {}) as Record<string, unknown>).workflowKey) || "").trim();
    if (key) set.add(key);
  }
  return [...set];
}

function buildThreadWorkflowCacheData(
  evidenceItems: Array<{ item: any; cacheText: string }>,
  options?: { maxTotalTokens?: number },
): string {
  if (!evidenceItems.length) return "";
  const maxTotalTokens = Math.max(2_000, options?.maxTotalTokens ?? contextConfig.cacheDataBudgetTokens);
  const parts: string[] = [];
  let usedTokens = 0;

  for (const entry of evidenceItems) {
    const item = entry.item;
    const meta = (item?.metadata || {}) as Record<string, unknown>;
    const workflowName = String(meta.workflowName || meta.workflowKey || "workflow");
    const workflowKey = String(meta.workflowKey || "");
    const createdAt = item?.createdAt ? new Date(item.createdAt).toISOString() : "";
    const fullEntry = [
      `Workflow: ${workflowName}${workflowKey ? ` (${workflowKey})` : ""}`,
      createdAt ? `CapturedAt: ${createdAt}` : "",
      "Result:",
      String(entry.cacheText || item?.content || ""),
    ]
      .filter(Boolean)
      .join("\n");
    const entryTokens = estimateTokens(fullEntry);

    if (usedTokens === 0 && entryTokens > maxTotalTokens) {
      return truncateToTokenBudget(fullEntry, maxTotalTokens);
    }
    if (usedTokens + entryTokens > maxTotalTokens) continue;
    parts.push(fullEntry);
    usedTokens += entryTokens;
  }

  return truncateToTokenBudget(parts.join("\n\n---\n\n"), maxTotalTokens);
}

export async function buildThreadEvidencePlan(input: {
  threadId: string;
  question: string;
  preferredWorkflowKey?: string;
  fallbackContextItem?: any;
}): Promise<{
  passA: { items: any[]; cacheData: string; workflowsUsed: string[] };
  passB: { items: any[]; cacheData: string; workflowsUsed: string[] };
  telemetry: { relevantRuns: number; requestedFields: string[]; usedFieldExtraction: boolean };
}> {
  const detailHeavy = isDetailHeavyFollowUpQuestion(input.question);
  const preferred = String(input.preferredWorkflowKey || "");
  const requestedFields = inferRequestedFieldHints(input.question);
  const relevantMatches = await ContextService.findRelevantWorkflowRuns(input.threadId, input.question, {
    limit: detailHeavy ? 10 : 6,
    preferredWorkflowKey: preferred || undefined,
  });
  const rankedItems = relevantMatches.map((match) => match.item);

  const rawA = rankedItems.length ? rankedItems : await getThreadWorkflowContextWindow(input.threadId, detailHeavy ? 10 : 8);
  const selectedA = selectThreadWorkflowWindowForQuestion(input.question, rawA, {
    maxItems: detailHeavy ? 6 : 4,
    maxDistinctWorkflows: detailHeavy ? 4 : 3,
    preferredWorkflowKey: preferred,
  });
  const passAItems = selectedA.length ? selectedA : (input.fallbackContextItem ? [input.fallbackContextItem] : rawA.slice(0, 1));

  const rawB = rankedItems.length ? rankedItems : await getThreadWorkflowContextWindow(input.threadId, detailHeavy ? 20 : 16);
  const selectedB = selectThreadWorkflowWindowForQuestion(input.question, rawB, {
    maxItems: detailHeavy ? 10 : 8,
    maxDistinctWorkflows: detailHeavy ? 6 : 5,
    preferredWorkflowKey: preferred,
  });
  const passBItems = selectedB.length ? selectedB : passAItems;

  const extractionLinesA = requestedFields.length
    ? await Promise.all(
      passAItems.slice(0, 2).map(async (item) => {
        const meta = (item?.metadata || {}) as Record<string, unknown>;
        const extracted = await ContextService.extractWorkflowRunFields(item, requestedFields);
        const entries = Object.entries(extracted.values);
        if (!entries.length) return "";
        return [
          `Exact fields from ${String(meta.workflowName || meta.workflowKey || "workflow")}:`,
          ...entries.map(([key, value]) => `- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`),
        ].join("\n");
      }),
    )
    : [];

  const extractionLinesB = requestedFields.length
    ? await Promise.all(
      passBItems.slice(0, 3).map(async (item) => {
        const meta = (item?.metadata || {}) as Record<string, unknown>;
        const extracted = await ContextService.extractWorkflowRunFields(item, requestedFields);
        const entries = Object.entries(extracted.values);
        if (!entries.length) return "";
        return [
          `Exact fields from ${String(meta.workflowName || meta.workflowKey || "workflow")}:`,
          ...entries.map(([key, value]) => `- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`),
        ].join("\n");
      }),
    )
    : [];

  const passAEvidence = await Promise.all(
    passAItems.map(async (item) => ({
      item,
      cacheText: await ContextService.loadCompleteWorkflowCache(item),
    })),
  );
  const passBEvidence = await Promise.all(
    passBItems.map(async (item) => ({
      item,
      cacheText: await ContextService.loadCompleteWorkflowCache(item),
    })),
  );

  return {
    passA: {
      items: passAItems,
      cacheData: [
        ...extractionLinesA.filter(Boolean),
        buildThreadWorkflowCacheData(passAEvidence, { maxTotalTokens: detailHeavy ? 36_000 : 24_000 }),
      ].filter(Boolean).join("\n\n"),
      workflowsUsed: collectWorkflowKeys(passAItems),
    },
    passB: {
      items: passBItems,
      cacheData: [
        ...extractionLinesB.filter(Boolean),
        buildThreadWorkflowCacheData(passBEvidence, { maxTotalTokens: contextConfig.cacheDataBudgetTokens }),
      ].filter(Boolean).join("\n\n"),
      workflowsUsed: collectWorkflowKeys(passBItems),
    },
    telemetry: {
      relevantRuns: relevantMatches.length,
      requestedFields,
      usedFieldExtraction: extractionLinesA.some(Boolean) || extractionLinesB.some(Boolean),
    },
  };
}
