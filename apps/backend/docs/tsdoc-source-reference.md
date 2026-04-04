# Backend TSDoc Source Reference

Generated from `apps/backend/src` on 2026-04-04T07:49:59.875Z.

- Files scanned: **92**
- Exported symbols documented: **182**

## How To Use

- Start from the file-level overview to find module responsibility.
- Use exported symbol entries to locate classes/functions/types quickly.
- For implementation details, open the source file and read inline TSDoc above each symbol.

## Module Index

### `apps/backend/src/config/context.config.ts`
- **Overview**: config/context.config module.
- **Exports**:
  - `const` `contextConfig`: contextConfig exported constant
  - `function` `getContextMaxRetrievalForModel`: getContextMaxRetrievalForModel helper function
  - `type` `ContextConfig`: ContextConfig type alias

### `apps/backend/src/config/runtime.config.ts`
- **Overview**: config/runtime.config module.
- **Exports**:
  - `type` `RuntimeApprovalMode`: RuntimeApprovalMode type alias
  - `type` `RuntimeConfig`: RuntimeConfig type alias
  - `class` `RuntimeConfigValidationError`: RuntimeConfigValidationError service class
  - `function` `getRuntimeConfig`: getRuntimeConfig helper function
  - `function` `isInteractiveQuestionEnforced`: isInteractiveQuestionEnforced helper function
  - `function` `resetRuntimeConfigCache`: resetRuntimeConfigCache helper function
  - `function` `updateRuntimeConfigFile`: updateRuntimeConfigFile helper function

### `apps/backend/src/db/guarded-push.ts`
- **Overview**: db/guarded-push module.
- **Exports**: None

### `apps/backend/src/db/index.ts`
- **Overview**: db/index module.
- **Exports**:
  - `const` `db`: Primary Drizzle database client bound to the full schema
  - `const` `dbClient`: Low-level `postgres` client for operations outside Drizzle's query builder
  - `function` `closeDbConnection`: Closes the active PostgreSQL connection pool during graceful shutdown

### `apps/backend/src/db/integrity.ts`
- **Overview**: db/integrity module.
- **Exports**:
  - `type` `OrphanWorkflowRun`: OrphanWorkflowRun type alias
  - `type` `OrphanApproval`: OrphanApproval type alias
  - `type` `OrphanNotificationRun`: OrphanNotificationRun type alias
  - `type` `DuplicateGoogleSub`: DuplicateGoogleSub type alias
  - `type` `IntegritySnapshot`: IntegritySnapshot type alias
  - `function` `findOrphanWorkflowRuns`: findOrphanWorkflowRuns helper function
  - `function` `findOrphanApprovals`: findOrphanApprovals helper function
  - `function` `findOrphanNotificationRuns`: findOrphanNotificationRuns helper function
  - `function` `findDuplicateGoogleSubs`: findDuplicateGoogleSubs helper function
  - `function` `collectIntegritySnapshot`: collectIntegritySnapshot helper function
  - `function` `formatIntegritySummary`: formatIntegritySummary helper function

### `apps/backend/src/db/preflight.ts`
- **Overview**: db/preflight module.
- **Exports**: None

### `apps/backend/src/db/repair.ts`
- **Overview**: db/repair module.
- **Exports**: None

### `apps/backend/src/db/schema.ts`
- **Overview**: db/schema module.
- **Exports**:
  - `const` `users`: User accounts table
  - `const` `chatThreads`: Chat threads (conversations) table
  - `const` `chatMessages`: Chat messages table
  - `const` `chatAttachments`: Chat attachments table
  - `const` `chatAttachmentChunks`: Chat attachment chunks table
  - `const` `workflows`: Workflow definitions table
  - `const` `workflowRuns`: Workflow execution runs table
  - `const` `approvals`: Approval requests table
  - `const` `notifications`: In-app notifications table
  - `const` `pushSubscriptions`: Web push subscriptions table
  - `const` `providerConfigs`: AI provider configurations table
  - `const` `webhookSecrets`: Webhook authentication secrets table
  - `const` `userConnections`: External service connections table
  - `const` `authSessions`: Authentication sessions table
  - `const` `contextMemory`: Context memory table for retrieval-augmented assistant behavior

### `apps/backend/src/db/seed.ts`
- **Overview**: db/seed module.
- **Exports**: None

### `apps/backend/src/index.ts`
- **Overview**: index module.
- **Exports**: None

### `apps/backend/src/middleware/auth.middleware.ts`
- **Overview**: middleware/auth.middleware module.
- **Exports**:
  - `function` `authMiddleware`: authMiddleware helper function
  - `function` `requireAuth`: requireAuth helper function

### `apps/backend/src/middleware/csrf.middleware.ts`
- **Overview**: middleware/csrf.middleware module.
- **Exports**:
  - `function` `csrfMiddleware`: csrfMiddleware helper function

### `apps/backend/src/middleware/error.middleware.ts`
- **Overview**: middleware/error.middleware module.
- **Exports**:
  - `function` `errorMiddleware`: errorMiddleware helper function

### `apps/backend/src/middleware/rate-limit.middleware.ts`
- **Overview**: middleware/rate-limit.middleware module.
- **Exports**:
  - `function` `rateLimit`: rateLimit helper function

### `apps/backend/src/middleware/security-headers.middleware.ts`
- **Overview**: middleware/security-headers.middleware module.
- **Exports**:
  - `function` `securityHeadersMiddleware`: securityHeadersMiddleware helper function

### `apps/backend/src/middleware/trace.middleware.ts`
- **Overview**: middleware/trace.middleware module.
- **Exports**:
  - `function` `traceMiddleware`: traceMiddleware helper function

### `apps/backend/src/middleware/validate.middleware.ts`
- **Overview**: middleware/validate.middleware module.
- **Exports**:
  - `const` `validate`: validate exported constant

### `apps/backend/src/middleware/webhook.middleware.ts`
- **Overview**: middleware/webhook.middleware module.
- **Exports**:
  - `const` `requireWebhookSecret`: requireWebhookSecret exported constant

### `apps/backend/src/providers/llm/gemini.provider.ts`
- **Overview**: providers/llm/gemini.provider module.
- **Exports**:
  - `class` `GeminiProvider`: GeminiProvider service class

### `apps/backend/src/providers/llm/llm.factory.ts`
- **Overview**: providers/llm/llm.factory module.
- **Exports**:
  - `class` `LLMFactory`: LLMFactory service class

### `apps/backend/src/providers/llm/ollama.provider.ts`
- **Overview**: providers/llm/ollama.provider module.
- **Exports**:
  - `class` `OllamaProvider`: OllamaProvider service class

### `apps/backend/src/providers/llm/openai.provider.ts`
- **Overview**: providers/llm/openai.provider module.
- **Exports**:
  - `class` `OpenAIProvider`: OpenAIProvider service class

### `apps/backend/src/providers/llm/provider.interface.ts`
- **Overview**: No file overview available
- **Exports**:
  - `type` `ParsedIntent`: ParsedIntent type alias
  - `interface` `WorkflowContext`: WorkflowContext type contract
  - `interface` `ConversationMessage`: /** A single message from conversation history, used for multi-turn context. */
  - `interface` `RetrievedContext`: /** Additional context retrieved from context-mode memory. */
  - `type` `LlmResponseMode`: LlmResponseMode type alias
  - `interface` `LlmGenerationOptions`: LlmGenerationOptions type contract
  - `interface` `ILLMProvider`: ILLMProvider type contract

### `apps/backend/src/providers/workflow/base.adapter.ts`
- **Overview**: providers/workflow/base.adapter module.
- **Exports**: None

### `apps/backend/src/providers/workflow/custom.adapter.ts`
- **Overview**: providers/workflow/custom.adapter module.
- **Exports**:
  - `class` `CustomAdapter`: No summary available

### `apps/backend/src/providers/workflow/factory.ts`
- **Overview**: providers/workflow/factory module.
- **Exports**:
  - `const` `WorkflowProviderFactory`: /** Singleton registry instance */

### `apps/backend/src/providers/workflow/index.ts`
- **Overview**: providers/workflow/index module.
- **Exports**: None

### `apps/backend/src/providers/workflow/make.adapter.ts`
- **Overview**: providers/workflow/make.adapter module.
- **Exports**:
  - `class` `MakeAdapter`: No summary available

### `apps/backend/src/providers/workflow/n8n.adapter.ts`
- **Overview**: providers/workflow/n8n.adapter module.
- **Exports**:
  - `class` `N8nAdapter`: No summary available

### `apps/backend/src/providers/workflow/provider.interface.ts`
- **Overview**: providers/workflow/provider.interface module.
- **Exports**:
  - `interface` `WorkflowProviderAdapter`: Every provider adapter must implement this interface

### `apps/backend/src/providers/workflow/sim.adapter.ts`
- **Overview**: providers/workflow/sim.adapter module.
- **Exports**:
  - `class` `SimAdapter`: No summary available

### `apps/backend/src/providers/workflow/types.ts`
- **Overview**: providers/workflow/types module.
- **Exports**:
  - `interface` `ValidationResult`: /** Result of validateConfig — tells the caller whether the workflow is correctly configured for this provider */
  - `interface` `NormalizedProviderResult`: /** Normalized result extracted from a raw provider response */
  - `interface` `NormalizedProviderError`: /** Normalized error extracted from a raw provider error */
  - `interface` `RunContext`: /** Context passed to fetchRunDetails */
  - `interface` `RunDetails`: /** Detailed run information returned from the provider */
  - `interface` `RunStep`: /** A single step in a provider's run execution */
  - `interface` `HealthCheckResult`: /** Health check result */

### `apps/backend/src/providers/workflow/zapier.adapter.ts`
- **Overview**: providers/workflow/zapier.adapter module.
- **Exports**:
  - `class` `ZapierAdapter`: No summary available

### `apps/backend/src/repositories/approval.repo.ts`
- **Overview**: repositories/approval.repo module.
- **Exports**:
  - `const` `ApprovalRepo`: ApprovalRepo exported constant

### `apps/backend/src/repositories/auth-session.repo.ts`
- **Overview**: repositories/auth-session.repo module.
- **Exports**:
  - `const` `AuthSessionRepo`: AuthSessionRepo exported constant

### `apps/backend/src/repositories/chat.repo.ts`
- **Overview**: repositories/chat.repo module.
- **Exports**:
  - `const` `ChatRepo`: ChatRepo exported constant

### `apps/backend/src/repositories/context.repo.ts`
- **Overview**: repositories/context.repo module.
- **Exports**:
  - `type` `ContextCategory`: No summary available
  - `interface` `CreateContextItemInput`: CreateContextItemInput type contract
  - `interface` `ContextItem`: ContextItem type contract
  - `const` `ContextRepo`: No summary available

### `apps/backend/src/repositories/notification.repo.ts`
- **Overview**: repositories/notification.repo module.
- **Exports**:
  - `const` `NotificationRepo`: NotificationRepo exported constant

### `apps/backend/src/repositories/push-subscription.repo.ts`
- **Overview**: repositories/push-subscription.repo module.
- **Exports**:
  - `interface` `PushSubscriptionInput`: PushSubscriptionInput type contract
  - `const` `PushSubscriptionRepo`: PushSubscriptionRepo exported constant

### `apps/backend/src/repositories/user.repo.ts`
- **Overview**: repositories/user.repo module.
- **Exports**:
  - `const` `UserRepo`: UserRepo exported constant

### `apps/backend/src/repositories/webhook-secret.repo.ts`
- **Overview**: repositories/webhook-secret.repo module.
- **Exports**:
  - `function` `hashWebhookSecret`: hashWebhookSecret helper function
  - `const` `WebhookSecretRepo`: WebhookSecretRepo exported constant

### `apps/backend/src/repositories/workflow.repo.ts`
- **Overview**: repositories/workflow.repo module.
- **Exports**:
  - `interface` `CreateWorkflowInput`: No summary available
  - `interface` `UpdateWorkflowInput`: UpdateWorkflowInput type contract
  - `interface` `CreateRunInput`: CreateRunInput type contract
  - `interface` `WorkflowFilterOptions`: WorkflowFilterOptions type contract
  - `const` `WorkflowRepo`: No summary available

### `apps/backend/src/routes/approvals.routes.ts`
- **Overview**: routes/approvals.routes module.
- **Exports**: None

### `apps/backend/src/routes/auth.routes.ts`
- **Overview**: routes/auth.routes module.
- **Exports**: None

### `apps/backend/src/routes/chat.routes.ts`
- **Overview**: routes/chat.routes module.
- **Exports**: None

### `apps/backend/src/routes/health.ts`
- **Overview**: routes/health module.
- **Exports**: None

### `apps/backend/src/routes/notifications.routes.ts`
- **Overview**: routes/notifications.routes module.
- **Exports**: None

### `apps/backend/src/routes/settings.routes.ts`
- **Overview**: routes/settings.routes module.
- **Exports**: None

### `apps/backend/src/routes/webhooks.routes.ts`
- **Overview**: routes/webhooks.routes module.
- **Exports**: None

### `apps/backend/src/routes/workflow-runs.routes.ts`
- **Overview**: routes/workflow-runs.routes module.
- **Exports**: None

### `apps/backend/src/routes/workflows.routes.ts`
- **Overview**: routes/workflows.routes module.
- **Exports**: None

### `apps/backend/src/schemas/approval.schema.ts`
- **Overview**: schemas/approval.schema module.
- **Exports**:
  - `const` `createApprovalSchema`: createApprovalSchema exported constant

### `apps/backend/src/schemas/chat.schema.ts`
- **Overview**: schemas/chat.schema module.
- **Exports**:
  - `const` `createThreadSchema`: createThreadSchema exported constant
  - `const` `addMessageSchema`: addMessageSchema exported constant
  - `const` `renameThreadSchema`: renameThreadSchema exported constant
  - `const` `answerQuestionSchema`: answerQuestionSchema exported constant

### `apps/backend/src/schemas/webhook.schema.ts`
- **Overview**: schemas/webhook.schema module.
- **Exports**:
  - `const` `n8nCallbackSchema`: /** n8n-specific callback schema (backward-compatible) */
  - `const` `unifiedCallbackSchema`: /** Unified provider callback schema */

### `apps/backend/src/schemas/workflow.schema.ts`
- **Overview**: schemas/workflow.schema module.
- **Exports**:
  - `const` `createWorkflowSchema`: No summary available
  - `const` `updateWorkflowSchema`: No summary available
  - `const` `triggerWorkflowSchema`: No summary available
  - `const` `testConnectionSchema`: No summary available

### `apps/backend/src/services/agent-runtime/mcp.service.ts`
- **Overview**: services/agent-runtime/mcp.service module.
- **Exports**:
  - `class` `AgentMcpService`: AgentMcpService service class

### `apps/backend/src/services/agent-runtime/tools/approval-tools.ts`
- **Overview**: services/agent-runtime/tools/approval-tools module.
- **Exports**:
  - `function` `createApprovalTools`: createApprovalTools helper function

### `apps/backend/src/services/agent-runtime/tools/context-tools.ts`
- **Overview**: services/agent-runtime/tools/context-tools module.
- **Exports**:
  - `function` `createContextTools`: createContextTools helper function

### `apps/backend/src/services/agent-runtime/tools/index.ts`
- **Overview**: services/agent-runtime/tools/index module.
- **Exports**:
  - `function` `createCoreAgentTools`: createCoreAgentTools helper function

### `apps/backend/src/services/agent-runtime/tools/system-tools.ts`
- **Overview**: services/agent-runtime/tools/system-tools module.
- **Exports**:
  - `function` `createSystemTools`: createSystemTools helper function

### `apps/backend/src/services/agent-runtime/tools/workflow-tools.ts`
- **Overview**: services/agent-runtime/tools/workflow-tools module.
- **Exports**:
  - `function` `createWorkflowTools`: createWorkflowTools helper function

### `apps/backend/src/services/agent-runtime/types.ts`
- **Overview**: services/agent-runtime/types module.
- **Exports**:
  - `type` `AgentToolRuntimeContext`: AgentToolRuntimeContext type alias
  - `type` `AgentToolMap`: AgentToolMap type alias
  - `type` `AgentRunInput`: AgentRunInput type alias
  - `type` `AgentRunOutput`: AgentRunOutput type alias

### `apps/backend/src/services/agent-runtime/workflow-execution.service.ts`
- **Overview**: services/agent-runtime/workflow-execution.service module.
- **Exports**:
  - `function` `resolveExecutableWorkflow`: resolveExecutableWorkflow helper function
  - `function` `executeWorkflowAwaitShared`: executeWorkflowAwaitShared helper function
  - `function` `triggerWorkflowAsyncShared`: triggerWorkflowAsyncShared helper function
  - `function` `createApprovalGateRunShared`: createApprovalGateRunShared helper function

### `apps/backend/src/services/agent.service.ts`
- **Overview**: services/agent.service module.
- **Exports**:
  - `class` `AgentService`: AgentService service class

### `apps/backend/src/services/approval.service.ts`
- **Overview**: services/approval.service module.
- **Exports**:
  - `class` `ApprovalService`: ApprovalService service class

### `apps/backend/src/services/attachment-processing.service.ts`
- **Overview**: services/attachment-processing.service module.
- **Exports**:
  - `type` `ProcessedAttachment`: ProcessedAttachment type alias
  - `class` `AttachmentProcessingService`: AttachmentProcessingService service class

### `apps/backend/src/services/attachment-scan.service.ts`
- **Overview**: services/attachment-scan.service module.
- **Exports**:
  - `class` `AttachmentScanService`: AttachmentScanService service class

### `apps/backend/src/services/attachment-storage.service.ts`
- **Overview**: services/attachment-storage.service module.
- **Exports**:
  - `class` `AttachmentStorageService`: AttachmentStorageService service class

### `apps/backend/src/services/auth.service.ts`
- **Overview**: services/auth.service module.
- **Exports**:
  - `type` `SafeUser`: SafeUser type alias
  - `function` `toSafeUser`: toSafeUser helper function
  - `class` `AuthService`: AuthService service class

### `apps/backend/src/services/auto-router.service.ts`
- **Overview**: services/auto-router.service module.
- **Exports**:
  - `type` `AutoRouterCandidate`: AutoRouterCandidate type alias
  - `type` `AutoRouterDecision`: AutoRouterDecision type alias
  - `class` `AutoModelRouterService`: AutoModelRouterService service class

### `apps/backend/src/services/chat.service.ts`
- **Overview**: services/chat.service module.
- **Exports**:
  - `class` `ChatService`: ChatService service class

### `apps/backend/src/services/context.service.ts`
- **Overview**: services/context.service module.
- **Exports**:
  - `interface` `IndexWorkflowRunParams`: No summary available
  - `interface` `IndexDecisionParams`: IndexDecisionParams type contract
  - `interface` `UpdateThreadStateParams`: UpdateThreadStateParams type contract
  - `interface` `IndexAuditEventParams`: IndexAuditEventParams type contract
  - `interface` `RetrievalOptions`: RetrievalOptions type contract
  - `interface` `PromptFormatOptions`: PromptFormatOptions type contract
  - `type` `CacheHitResult`: CacheHitResult type alias
  - `type` `RelevantWorkflowRunMatch`: RelevantWorkflowRunMatch type alias
  - `class` `ContextService`: No summary available

### `apps/backend/src/services/document-extraction.service.ts`
- **Overview**: services/document-extraction.service module.
- **Exports**:
  - `type` `ExtractionQuality`: ExtractionQuality type alias
  - `type` `ExtractionSource`: ExtractionSource type alias
  - `type` `DocumentChunk`: DocumentChunk type alias
  - `type` `DocumentExtractionResult`: DocumentExtractionResult type alias
  - `class` `DocumentExtractionService`: DocumentExtractionService service class

### `apps/backend/src/services/event.service.ts`
- **Overview**: services/event.service module.
- **Exports**:
  - `const` `eventBus`: eventBus exported constant
  - `const` `EventTypes`: EventTypes exported constant

### `apps/backend/src/services/llm.service.ts`
- **Overview**: services/llm.service module.
- **Exports**:
  - `class` `LLMService`: LLMService service class

### `apps/backend/src/services/main-agent.service.ts`
- **Overview**: services/main-agent.service module.
- **Exports**:
  - `type` `AgentRiskLevel`: AgentRiskLevel type alias
  - `type` `AgentConfidence`: AgentConfidence type alias
  - `type` `ReActObservation`: ReActObservation type alias
  - `type` `ReActCandidateSnapshot`: ReActCandidateSnapshot type alias
  - `type` `ReActState`: ReActState type alias
  - `type` `AgentDecision`: AgentDecision type alias
  - `function` `extendDecisionReActState`: extendDecisionReActState helper function
  - `class` `MainAgentService`: MainAgentService service class

### `apps/backend/src/services/n8n.service.ts`
- **Overview**: No file overview available
- **Exports**:
  - `class` `N8nService`: N8nService service class

### `apps/backend/src/services/notification.service.ts`
- **Overview**: services/notification.service module.
- **Exports**:
  - `class` `NotificationService`: NotificationService service class

### `apps/backend/src/services/orchestrator.service.ts`
- **Overview**: services/orchestrator.service module.
- **Exports**:
  - `class` `OrchestratorService`: No summary available

### `apps/backend/src/services/pdf-extraction.service.ts`
- **Overview**: services/pdf-extraction.service module.
- **Exports**:
  - `type` `ExtractionQuality`: ExtractionQuality type alias
  - `type` `PdfChunk`: PdfChunk type alias
  - `type` `PdfExtractionResult`: PdfExtractionResult type alias
  - `class` `PdfExtractionService`: PdfExtractionService service class

### `apps/backend/src/services/push.service.ts`
- **Overview**: services/push.service module.
- **Exports**:
  - `class` `PushService`: PushService service class

### `apps/backend/src/services/react-telemetry-analytics.service.ts`
- **Overview**: services/react-telemetry-analytics.service module.
- **Exports**:
  - `class` `ReActTelemetryAnalyticsService`: ReActTelemetryAnalyticsService service class

### `apps/backend/src/services/react-telemetry.service.ts`
- **Overview**: No file overview available
- **Exports**:
  - `type` `ReActTelemetryEvent`: ReActTelemetryEvent type alias
  - `function` `buildReActTelemetryMetadata`: buildReActTelemetryMetadata helper function
  - `function` `logReActTelemetry`: logReActTelemetry helper function

### `apps/backend/src/services/temporal.service.ts`
- **Overview**: services/temporal.service module.
- **Exports**:
  - `type` `TemporalResolutionInput`: TemporalResolutionInput type alias
  - `type` `TemporalAnswer`: TemporalAnswer type alias
  - `class` `TemporalService`: TemporalService service class

### `apps/backend/src/services/workflow-summary.service.ts`
- **Overview**: services/workflow-summary.service module.
- **Exports**:
  - `interface` `CallbackSummaryInput`: CallbackSummaryInput type contract
  - `interface` `WorkflowNotificationSummary`: WorkflowNotificationSummary type contract
  - `class` `WorkflowSummaryService`: WorkflowSummaryService service class

### `apps/backend/src/services/workflow.service.ts`
- **Overview**: services/workflow.service module.
- **Exports**:
  - `class` `WorkflowService`: No summary available

### `apps/backend/src/types/express-auth.d.ts`
- **Overview**: types/express-auth.d module.
- **Exports**: None

### `apps/backend/src/types/web-push.d.ts`
- **Overview**: types/web-push.d module.
- **Exports**: None

### `apps/backend/src/util/logger.ts`
- **Overview**: util/logger module.
- **Exports**:
  - `const` `logger`: logger exported constant

### `apps/backend/src/util/metrics.ts`
- **Overview**: util/metrics module.
- **Exports**:
  - `function` `incrementCounter`: incrementCounter helper function
  - `function` `observeHistogram`: observeHistogram helper function
  - `function` `flushMetricsExporter`: flushMetricsExporter helper function
  - `function` `stopMetricsExporter`: stopMetricsExporter helper function
  - `function` `renderPrometheusMetrics`: renderPrometheusMetrics helper function

### `apps/backend/src/util/network-safety.ts`
- **Overview**: util/network-safety module.
- **Exports**:
  - `function` `isPrivateOrLocalHost`: isPrivateOrLocalHost helper function
  - `function` `assertSafeOutboundUrl`: assertSafeOutboundUrl helper function

### `apps/backend/src/util/thread-id.ts`
- **Overview**: util/thread-id module.
- **Exports**:
  - `function` `generateThreadId`: generateThreadId helper function

