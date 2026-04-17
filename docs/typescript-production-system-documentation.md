# TypeScript Production System Documentation

## 📝 Annotated Source (with TypeScript doc comments)

The production system now includes TSDoc-annotated runtime API entry points in:
- apps/backend/src/config/runtime.config.ts

```ts
/**
 * Returns the current normalized runtime configuration.
 *
 * @returns Fully merged and validated runtime config.
 * @throws {@link RuntimeConfigValidationError} When file/env inputs are invalid.
 *
 * @example
 * ```ts
 * const config = getRuntimeConfig();
 * console.log(config.auth.frontendOrigin);
 * ```
 */
export const getRuntimeConfig = () => RuntimeConfigManager.getRuntimeConfig();

/**
 * Persists selected runtime updates and returns refreshed configuration.
 *
 * @param updates - Partial runtime fields to update in config.json.
 * @returns Updated runtime config after persistence and cache refresh.
 * @throws {@link RuntimeConfigValidationError} When updated values violate
 * runtime validation constraints.
 *
 * @example
 * ```ts
 * const next = updateRuntimeConfigFile({
 *   forceInteractiveQuestions: true,
 * });
 * ```
 */
export const updateRuntimeConfigFile = (updates: any) => RuntimeConfigManager.updateRuntimeConfigFile(updates);

/**
 * Returns whether interactive follow-up questions are enforced.
 *
 * @remarks
 * This helper is used by orchestration layers to decide whether the assistant
 * should emit follow-up question blocks instead of proceeding automatically.
 *
 * @returns `true` when interactive questioning is required by runtime policy.
 * @throws {@link RuntimeConfigValidationError} When runtime configuration fails
 * validation during lazy loading.
 *
 * @example
 * ```ts
 * if (isInteractiveQuestionEnforced()) {
 *   // Render interactive options in chat UI.
 * }
 * ```
 */
export function isInteractiveQuestionEnforced(): boolean {
  return getRuntimeConfig().forceInteractiveQuestions;
}
```

## 📁 Project Structure

chat-automation-platform
├── apps/backend/src/index.ts — Express bootstrap, security middleware, route wiring, graceful shutdown
├── apps/backend/src/config/runtime.config.ts — runtime contract, validation, cache, persistence adapters
└── packages/shared/src/chat-block.types.ts — cross-app chat block DTO contract and structural guard

## 📌 Overview

This production TypeScript system provides a chat-first automation backend with strict runtime configuration controls and a shared rendering contract between backend and frontend. It solves a common reliability problem in AI automation platforms: configuration drift, inconsistent payload shapes, and unsafe bootstrap defaults under deployment conditions. The backend bootstrap enforces security middleware and production guardrails before any route is reachable, while runtime configuration is normalized and validated through explicit schema-driven checks. Shared DTOs make chat responses predictable across API and UI layers.

## 🧩 Components Breakdown

#### bootstrap (apps/backend/src/index.ts)
- Type: Function
- Description: Starts the backend by priming runtime config, validating attachment schema readiness, optionally enabling static frontend serving, then binding the HTTP listener.
- Parameters: none
- Returns: Promise<void>
- Example Usage:
```ts
await bootstrap();
```
- Notes: Fails fast when runtime configuration or schema preconditions are invalid.

#### gracefulShutdown (apps/backend/src/index.ts)
- Type: Function
- Description: Stops inbound traffic, flushes and stops metrics, closes DB connections, and exits the process safely.
- Parameters:
  - signal (string): OS signal initiating shutdown.
- Returns: Promise<void>
- Example Usage:
```ts
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
```
- Notes: Includes a force-close timeout to avoid hanging deploys.

#### registerStaticFrontend (apps/backend/src/index.ts)
- Type: Function
- Description: Mounts static assets and SPA fallback while excluding API and health paths.
- Parameters:
  - staticFrontendDir (string): Build output directory containing index.html.
- Returns: void
- Example Usage:
```ts
registerStaticFrontend('/app/frontend/dist');
```

#### RuntimeConfigValidationError (apps/backend/src/config/runtime.config.ts)
- Type: Class
- Description: Structured validation error with per-field fix hints for invalid runtime settings.
- Parameters:
  - issues (RuntimeValidationIssue[]): validation errors including path, expected shape, and remediation hint.
- Returns: RuntimeConfigValidationError instance
- Example Usage:
```ts
throw new RuntimeConfigValidationError([
  {
    path: 'auth.frontendOrigin',
    expected: 'valid URL',
    received: 'localhost',
    fixHint: 'Set FRONTEND_ORIGIN to a full https:// URL',
  },
]);
```

#### getRuntimeConfig (apps/backend/src/config/runtime.config.ts)
- Type: Function
- Description: Returns cached or newly loaded runtime config after merge + validation.
- Parameters: none
- Returns: RuntimeConfig
- Example Usage:
```ts
const runtime = getRuntimeConfig();
const origin = runtime.auth.frontendOrigin;
```
- Notes: Throws RuntimeConfigValidationError for invalid file/env data.

#### updateRuntimeConfigFile / updateRuntimeConfigFileAsync (apps/backend/src/config/runtime.config.ts)
- Type: Function
- Description: Persists selected config updates and refreshes in-memory runtime cache.
- Parameters:
  - updates (RuntimeConfigUpdates): subset of mutable runtime settings.
- Returns: RuntimeConfig | Promise<RuntimeConfig>
- Example Usage:
```ts
const updated = await updateRuntimeConfigFileAsync({
  forceInteractiveQuestions: false,
});
```

#### RuntimeConfigManager (apps/backend/src/config/runtime.config.ts)
- Type: Constant (facade object)
- Description: Mockable runtime config API used by wrappers and tests.
- Parameters: none
- Returns: Object with get/update/reset/prime methods
- Example Usage:
```ts
const cfg = RuntimeConfigManager.getRuntimeConfig();
```

#### ChatBlockDto and isChatBlocksEnvelope (packages/shared/src/chat-block.types.ts)
- Type: Type union + Function
- Description: Defines canonical chat block payloads and validates envelope shape for runtime safety.
- Parameters:
  - value (unknown): arbitrary payload to validate.
- Returns: value is ChatBlocksEnvelope
- Example Usage:
```ts
const payload: unknown = { blocks: [{ type: 'summary', items: ['ok'] }] };
if (isChatBlocksEnvelope(payload)) {
  // payload is now narrowed to ChatBlocksEnvelope
}
```
- Notes: Type guard validates structural minimum only (blocks array + string type).

## 🔄 Flow Explanation

1. Process startup imports app modules and resolves runtime config lazily.
2. Production guard block validates critical secrets and required origins before server listen.
3. Middleware chain is registered in security-first order: headers, auth, CSRF, rate limiting, trace.
4. Route modules are mounted with explicit auth requirements per namespace.
5. bootstrap primes runtime config and verifies attachment schema readiness.
6. If FRONTEND_STATIC_DIR is configured and index.html exists, backend serves frontend assets and SPA fallback.
7. HTTP server starts and logs runtime context for operability.
8. On SIGTERM/SIGINT, gracefulShutdown closes listener, metrics exporters, and DB pool in controlled sequence.
9. During request handling, services emit chat block payloads that must remain compatible with ChatBlockDto.

## ⚠️ Edge Cases & Notes

⚠️ Security: FRONTEND_ORIGIN and CALLBACK_BASE_URL must be explicit HTTPS URLs in production. Missing or weak values can break auth boundaries and webhook trust assumptions.

⚠️ Security: Runtime secret enforcement includes AUTH_COOKIE_SECRET and PROVIDER_API_KEY_ENCRYPTION_KEY minimum length checks. Weak defaults are rejected in production startup.

⚠️ Security: Shared block type guard is structural; it does not deeply validate field-level constraints for each block variant. Treat untrusted payloads with schema validation before persistence.

- Input edge cases:
  - Empty or malformed config.json triggers RuntimeConfigValidationError with fix hints.
  - Non-object config file content is treated as empty object fallback.
  - FRONTEND_STATIC_DIR set without index.html logs warning and skips static hosting.
- Performance risks:
  - Very large allowed MIME type lists or model-retrieval maps can increase startup parse/validation cost.
  - Repeated runtime cache resets force disk + env reparse on next access.
- Availability notes:
  - Shutdown includes a 15s safeguard timeout to avoid indefinite close wait.
  - Metrics flush failures are tolerated with warnings to preserve shutdown completion.

> 🔶 Assumption: RuntimeConfigManager wrapper methods are consumed by test seams and administrative settings routes; direct mutation from unrelated modules is discouraged.

## 📈 Complexity Analysis

| Component | Time Complexity | Space Complexity | Notes |
|-----------|-----------------|------------------|-------|
| getRuntimeConfig (cold path) | O(k + m + s) | O(k + m + s) | k: config keys parsed, m: MIME list length, s: MCP server entries |
| getRuntimeConfig (warm path) | O(1) | O(1) | Returns cached object |
| readConfigFile | O(n) | O(n) | n: config JSON text size |
| isChatBlocksEnvelope | O(b) | O(1) | b: number of blocks in envelope |
| gracefulShutdown | O(1) | O(1) | Constant number of shutdown stages |

## 🧪 Example Input / Output

Input:
RUNTIME env includes AUTH_COOKIE_SECRET=dev_auth_secret_change_me in production

Output:
Process startup throws Error: Missing required production env vars: AUTH_COOKIE_SECRET

Explanation:
Production bootstrap enforces non-default secret requirements to prevent insecure cookie signing.

Input:
unknown payload = { blocks: [{ type: 'source', metadata: ['kb'] }] }

Output:
isChatBlocksEnvelope(payload) => true

Explanation:
Envelope satisfies structural guard (top-level blocks array and string block type).

Input:
config.json contains malformed JSON text

Output:
RuntimeConfigValidationError with issue path=configPath and parse/read fix hint

Explanation:
Runtime loader treats unreadable/invalid JSON as a hard validation failure with actionable diagnostics.

## 💡 Suggested Improvements

1. Add strict discriminated schema validation for each ChatBlockDto variant at API boundaries.
2. Replace any-typed wrapper update parameters with RuntimeConfigUpdates in exported wrappers for stronger compile-time safety.
3. Add startup health diagnostics endpoint section that reports config source provenance (file/env) without secret values.
4. Add integration tests for static frontend fallback exclusions on /api and /health paths.
5. Add rate-limit partitioning by route risk class (auth-sensitive vs read-only endpoints).

---

## 📝 Annotated Source (with TypeScript doc comments) — Extended Modules

Additional public APIs now include TSDoc in:
- apps/backend/src/services/context/context.types.ts
- apps/backend/src/services/context/prompt-context.service.ts
- apps/backend/src/services/orchestrator/orchestrator-route.service.ts

```ts
/**
 * Classifies a user turn into deterministic follow-up routing categories.
 *
 * @param threadId - Conversation thread identifier.
 * @param message - Current user message.
 * @returns Classified follow-up route used by orchestrator flow control.
 *
 * @example
 * ```ts
 * const route = await classifyFollowUpRoute(threadId, 'run now');
 * if (route.kind === 'explicit_rerun') {
 *   // Dispatch selected workflow again.
 * }
 * ```
 */
export async function classifyFollowUpRoute(threadId: string, message: string): Promise<FollowUpRoute> {
  // implementation
}
```

## 📁 Project Structure (Expanded)

chat-automation-platform
├── apps/backend/src/services/ai-routing/main-agent.service.ts — ReAct-like planner for chat vs workflow mode
├── apps/backend/src/services/orchestrator/orchestrator.service.ts — streaming orchestration and decision execution
├── apps/backend/src/services/orchestrator/orchestrator-route.service.ts — deterministic follow-up routing
├── apps/backend/src/services/context/context.service.ts — context indexing, retrieval, cache-hit policy
├── apps/backend/src/services/context/prompt-context.service.ts — hybrid prompt construction
├── apps/backend/src/services/context/context-memory-extraction.service.ts — memory candidate extraction + indexing
├── apps/backend/src/services/attachments/attachment-processing.service.ts — scanning, extraction fallback chain, chunking
├── apps/backend/src/services/attachments/attachment-scan.service.ts — ClamAV/HTTP malware scan bridge
├── apps/backend/src/services/retrieval/* — embeddings, semantic search, RAG, recommendations
├── apps/backend/src/services/auth/auth.service.ts — session/OAuth/MFA orchestration
├── apps/backend/src/services/telemetry/* — frontend and ReAct telemetry normalization + analytics
└── apps/backend/src/services/workflow/workflow.service.ts — workflow CRUD + execution lifecycle + indexing hooks

## 📌 Overview (Expanded)

The updated system introduces a production-focused orchestration stack with deterministic follow-up routing, guarded workflow execution, retrieval-grounded answers, and memory-aware context injection. It combines a planning layer (`MainAgentService`) with a robust streaming orchestrator that can answer from cache, rerun workflows, or request approvals depending on risk and intent confidence. A retrieval subsystem now unifies embeddings, semantic search, RAG attachment context, and recommendations, while context services persist workflow/audit/thread-state memory for multi-turn reliability. Security hardening is embedded through attachment scanning, runtime secret validation, and auth/session/mfa controls.

## 🧩 Components Breakdown (Broader Coverage)

#### MainAgentService.decide (apps/backend/src/services/ai-routing/main-agent.service.ts)
- Type: Method
- Description: Produces a structured agent decision (`chat` vs `workflow`) with shortlisted candidates, confidence, risk evaluation, and execution/approval next action.
- Parameters:
  - input.userMessage (string): user turn text
  - input.history (ConversationMessage[]): prior turns
  - input.context (RetrievedContext): retrieval context
- Returns: Promise<AgentDecision>
- Example Usage:
```ts
const decision = await MainAgentService.decide({ userMessage, history, context });
```

#### OrchestratorService.handleStreamingMessage (apps/backend/src/services/orchestrator/orchestrator.service.ts)
- Type: Method
- Description: End-to-end streaming path that classifies route, applies cache policies, optionally executes workflows, builds response blocks, and persists final assistant message.
- Parameters: thread/user/trace identifiers, message, provider/model, attachments, stream callbacks
- Returns: Promise<{ id: string; createdAt: any }>

#### classifyFollowUpRoute (apps/backend/src/services/orchestrator/orchestrator-route.service.ts)
- Type: Function
- Description: Detects follow-up intents like rerun, show-previous, use-cached-choice, and non-execution follow-up answers.
- Returns: Promise<FollowUpRoute>

#### ContextService.evaluateCacheHit (apps/backend/src/services/context/context.service.ts)
- Type: Method
- Description: Determines whether workflow intent can be answered from fresh successful context memory without rerunning workflow.
- Returns: Promise<CacheHitResult>

#### PromptContextService.buildHybridThreadPromptContext (apps/backend/src/services/context/prompt-context.service.ts)
- Type: Method
- Description: Builds temporal + exact + semantic prompt context under token budgets and emits telemetry.
- Returns: Promise<{ contextText: string; retrievedContext?: RetrievedContext }>

#### AttachmentProcessingService.processAttachment (apps/backend/src/services/attachments/attachment-processing.service.ts)
- Type: Method
- Description: Applies malware scan, unsafe-content checks, OCR/document extraction fallback chain, and normalized metadata/chunk generation.
- Returns: Promise<ProcessedAttachment>

#### SemanticSearchService.searchWorkflows/searchDocuments/searchRuns (apps/backend/src/services/retrieval/semantic-search.service.ts)
- Type: Methods
- Description: Vector-search APIs with embedding cache/result cache and lexical/unavailable degradation behavior.

#### AuthService session + MFA APIs (apps/backend/src/services/auth/auth.service.ts)
- Type: Class methods
- Description: Password policy, OAuth PKCE state, session cookie lifecycle, TOTP setup/verification, and session revocation controls.

#### WorkflowService.executeAndAwait (apps/backend/src/services/workflow/workflow.service.ts)
- Type: Method
- Description: Creates run, dispatches provider adapter, awaits completion, updates context + telemetry hooks, emits workflow events.

## 🔄 Flow Explanation (Extended)

1. User message enters orchestrator streaming handler.
2. Prompt context service builds deterministic temporal section plus hybrid retrieved context.
3. Follow-up router checks if request should show previous data, rerun workflow, or answer from cached context window.
4. Main agent decides mode and produces confidence/risk + action state.
5. For workflow mode:
   - approval gate may pause execution
   - cache-hit path may answer from prior run
   - miss path dispatches workflow and streams status + result blocks
6. For chat mode:
   - LLM stream replies directly
   - optional email-draft mode transforms output into structured blocks
7. Attachment path enriches prompt with RAG chunks and strict grounded mode for evidence-bound answers.
8. Context service indexes decisions/runs/thread-state and supports subsequent follow-up resolution.
9. Telemetry services record block-level ReAct metadata and frontend runtime events.

## ⚠️ Edge Cases & Notes (Extended)

⚠️ Security: Attachment processing blocks executable magic bytes and suspicious script/prompt-injection content even when MIME appears benign.

⚠️ Security: Fail-closed scan mode may reject uploads when scanner transport fails; this protects production but can affect availability.

⚠️ Security: OAuth and session cookies depend on non-default secrets in production; weak or placeholder values are rejected.

- Input/behavior edge cases:
  - Follow-up messages like "yes" are resolved against prior assistant prompt to infer pending workflow safely.
  - Ambiguous workflow candidate scores trigger clarification path instead of auto-execution.
  - Cache-hit policy bypasses stale, failed, or parameterized prior runs.
  - Missing semantic retrieval availability degrades to lexical/no-result paths.
- Performance risks:
  - Embedding generation and semantic lookup can add tail latency under high cardinality threads.
  - Large attachment OCR/document parsing may hit processing timeout safeguards.
  - Context formatting under high history volume must respect token budgets to prevent prompt bloat.

> 🔶 Assumption: Context-mode remains enabled in production for follow-up quality; if disabled, deterministic follow-up depth is reduced.

## 📈 Complexity Analysis (Extended)

| Component | Time Complexity | Space Complexity | Notes |
|-----------|-----------------|------------------|-------|
| MainAgentService.decide | O(w * t) | O(w + t) | w: candidate workflows, t: token overlap features |
| classifyFollowUpRoute | O(m + c) | O(c) | m: recent messages scanned, c: context items sampled |
| ContextService.formatForPrompt | O(i) | O(i) | i: retrieved context items under token budget |
| AttachmentProcessingService.processAttachment | O(n + p) | O(n) | n: file size, p: extracted pages/chunks |
| SemanticSearchService.search* | O(e + k) | O(k) | e: embedding call, k: top-k rows processed |
| WorkflowService.executeAndAwait | O(1) app-side + provider latency | O(1) | Dominated by external provider execution |

## 🧪 Example Input / Output (Extended)

Input:
User: "run now"
Previous assistant prompt asked for approval on workflow `resume_parser`

Output:
Route => explicit_rerun with workflowKey=`resume_parser`

Explanation:
Confirmation-like command is mapped to pending workflow inferred from prior question block/source metadata.

Input:
User asks follow-up: "what was the candidate email from last run?"

Output:
Route => followup_answer; orchestrator answers from thread context window without rerun

Explanation:
Non-execution follow-up with resolvable context avoids unnecessary provider invocation.

Input:
Attachment scan returns error and fail-closed is enabled

Output:
processingStatus=`failed`, error="Attachment scanning failed and fail-closed mode is enabled."

Explanation:
Security policy prefers blocking unknown risk over processing unscanned content.
