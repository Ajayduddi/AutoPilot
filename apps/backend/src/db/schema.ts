import { pgTable, text, timestamp, boolean, jsonb, integer, index } from 'drizzle-orm/pg-core';

/**
 * @fileoverview Database schema definitions using Drizzle ORM for PostgreSQL.
 *
 * This module defines all database tables, relationships, indexes, and constraints
 * for the chat automation platform. Tables are organized by domain: users, chat,
 * workflows, approvals, notifications, and context memory.
 *
 * @module db/schema
 * @see {@link https://orm.drizzle.team/docs/schema Drizzle Schema Docs}
 */

// =============================================================================
// USERS DOMAIN
// =============================================================================

/**
 * User accounts table.
 *
 * Stores user identity and authentication data. Users can authenticate via:
 * - Email/password (passwordHash stored)
 * - Google OAuth (googleSub stored)
 *
 * @remarks
 * - Email is unique across all users
 * - Password stored as bcrypt hash, never plaintext
 * - timezone is optional, defaults to UTC on frontend
 *
 * @example
 * // Creating a user record
 * await db.insert(users).values({
 *   id: generateId(),
 *   email: 'user@example.com',
 *   name: 'John Doe',
 * });
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name'),
  timezone: text('timezone'),
  passwordHash: text('password_hash'),
  googleSub: text('google_sub').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// =============================================================================
// CHAT DOMAIN
// =============================================================================

/**
 * Chat threads (conversations) table.
 *
 * Each thread represents a conversation between a user and the assistant.
 * Threads contain multiple messages and can have associated attachments.
 *
 * @remarks
 * - title is auto-generated from first message or user-provided
 * - updatedAt is updated on each new message
 *
 * @example
 * // Creating a new thread
 * await db.insert(chatThreads).values({
 *   id: generateId(),
 *   userId: 'user_123',
 *   title: 'New Conversation',
 * });
 */
export const chatThreads = pgTable('chat_threads', {
  id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id).notNull(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Chat messages table.
 *
 * Individual messages within a chat thread. Supports rich content via blocks
 * (UI components, code blocks, etc.) with plain text fallback.
 *
 * @remarks
 * - role: 'user' | 'assistant' | 'system' - determines message origin
 * - content: Plain text fallback for backward compatibility
 * - blocks: JSON array of UI block definitions (code, tables, actions, etc.)
 *
 * @example
 * // Inserting a user message
 * await db.insert(chatMessages).values({
 *   id: generateId(),
 *   threadId: 'thread_123',
 *   role: 'user',
 *   content: 'What is the weather today?',
 * });
 */
export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
    threadId: text('thread_id').references(() => chatThreads.id).notNull(),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content'), // Plain text fallback
  blocks: jsonb('blocks'), // Rich UI blocks array
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Chat attachments table.
 *
 * Files uploaded by users and attached to messages. Supports document processing
 * with extracted text, metadata, and chunking for search/retrieval.
 *
 * @remarks
 * - processingStatus tracks the document processing pipeline
 * - extractedText contains parsed content for RAG/semantic search
 * - checksum enables deduplication of uploads
 *
 * @example
 * // Creating an attachment record after upload
 * await db.insert(chatAttachments).values({
 *   id: generateId(),
 *   userId: 'user_123',
 *   threadId: 'thread_456',
 *   filename: 'report.pdf',
 *   mimeType: 'application/pdf',
 *   sizeBytes: 102400,
 *   storagePath: '/uploads/user_123/report.pdf',
 *   checksum: 'sha256:abc123...',
 *   processingStatus: 'uploaded',
 * });
 */
export const chatAttachments = pgTable('chat_attachments', {
  id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id).notNull(),
    threadId: text('thread_id').references(() => chatThreads.id),
    messageId: text('message_id').references(() => chatMessages.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storagePath: text('storage_path').notNull(),
  checksum: text('checksum').notNull(),
  processingStatus: text('processing_status', {
    enum: ['uploaded', 'processing', 'processed', 'failed', 'not_parsable'],
  }).default('uploaded').notNull(),
  extractedText: text('extracted_text'),
  structuredMetadata: jsonb('structured_metadata'),
  previewData: jsonb('preview_data'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_chat_attachments_user').on(table.userId),
  index('idx_chat_attachments_thread').on(table.threadId),
  index('idx_chat_attachments_message').on(table.messageId),
  index('idx_chat_attachments_checksum').on(table.checksum),
]);

/**
 * Chat attachment chunks table.
 *
 * Text chunks extracted from attachments for semantic search and RAG.
 * Documents are split into smaller chunks for embedding and retrieval.
 *
 * @remarks
 * - chunkIndex maintains chunk order within a document
 * - tokenCount enables token-budget-aware retrieval
 * - metadata can include page numbers, section headers, etc.
 *
 * @example
 * // Inserting a text chunk
 * await db.insert(chatAttachmentChunks).values({
 *   id: generateId(),
 *   attachmentId: 'attachment_123',
 *   userId: 'user_456',
 *   chunkIndex: 0,
 *   content: 'This is the first paragraph of the document...',
 *   tokenCount: 42,
 * });
 */
export const chatAttachmentChunks = pgTable('chat_attachment_chunks', {
  id: text('id').primaryKey(),
    attachmentId: text('attachment_id').references(() => chatAttachments.id).notNull(),
    userId: text('user_id').references(() => users.id).notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  tokenCount: integer('token_count'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_chat_attachment_chunks_attachment').on(table.attachmentId),
  index('idx_chat_attachment_chunks_user').on(table.userId),
]);

// =============================================================================
// WORKFLOWS DOMAIN
// =============================================================================

/**
 * Workflow definitions table.
 *
 * Unified workflow configuration supporting multiple automation providers:
 * n8n, Zapier, Make.com, simulation, and custom implementations.
 *
 * @remarks
 * - key: Unique human-readable identifier for the workflow
 * - provider: The automation platform executing this workflow
 * - visibility: 'public' (shared) or 'private' (owner only)
 * - triggerMethod: How the workflow is invoked (webhook, API, internal)
 * - authType: Authentication method for webhook calls
 * - requiresApproval: If true, creates approval request before execution
 *
 * @example
 * // Creating an n8n webhook workflow
 * await db.insert(workflows).values({
 *   id: generateId(),
 *   key: 'send-welcome-email',
 *   name: 'Send Welcome Email',
 *   provider: 'n8n',
 *   executionEndpoint: 'https://n8n.example.com/webhook/welcome',
 *   authType: 'header_secret',
 * });
 */
export const workflows = pgTable('workflows', {
  id: text('id').primaryKey(),
  key: text('key').unique().notNull(),
  name: text('name').notNull(),
  description: text('description'),
  provider: text('provider', {
    enum: ['n8n', 'zapier', 'make', 'sim', 'custom'],
  }).default('n8n').notNull(),
  visibility: text('visibility', {
    enum: ['public', 'private'],
  }).default('public').notNull(),
    ownerUserId: text('owner_user_id').references(() => users.id),
  enabled: boolean('enabled').default(true).notNull(),
  archived: boolean('archived').default(false).notNull(),
  requiresApproval: boolean('requires_approval').default(false).notNull(),
  triggerMethod: text('trigger_method', {
    enum: ['webhook', 'api', 'internal'],
  }).default('webhook').notNull(),
  executionEndpoint: text('execution_endpoint'),
  httpMethod: text('http_method', {
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }).default('POST').notNull(),
  authType: text('auth_type', {
    enum: ['none', 'bearer', 'api_key', 'header_secret', 'custom'],
  }).default('none').notNull(),
  authConfig: jsonb('auth_config'),
  inputSchema: jsonb('input_schema'),
  outputSchema: jsonb('output_schema'),
  tags: jsonb('tags').$type<string[]>().default([]),
  metadata: jsonb('metadata'),
  version: integer('version').default(1).notNull(),
  lastRunAt: timestamp('last_run_at'),
  lastRunStatus: text('last_run_status', {
    enum: ['queued', 'running', 'completed', 'failed', 'waiting_approval'],
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Workflow execution runs table.
 *
 * Records each execution of a workflow, tracking status, inputs, outputs,
 * and errors. Enables audit trails and debugging.
 *
 * @remarks
 * - traceId: Distributed tracing identifier for request correlation
 * - triggerSource: Origin of the execution (ui, chat, api, system)
 * - status: Execution state machine (queued → running → completed/failed)
 * - normalizedOutput: Provider-agnostic response format
 *
 * @example
 * // Creating a workflow run
 * await db.insert(workflowRuns).values({
 *   id: generateId(),
 *   workflowId: 'workflow_123',
 *   workflowKey: 'send-welcome-email',
 *   provider: 'n8n',
 *   traceId: 'trace_abc123',
 *   userId: 'user_456',
 *   status: 'running',
 *   inputPayload: { email: 'user@example.com' },
 * });
 */
export const workflowRuns = pgTable('workflow_runs', {
  id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflows.id).notNull(),
  workflowKey: text('workflow_key').notNull(),
  provider: text('provider', {
    enum: ['n8n', 'zapier', 'make', 'sim', 'custom'],
  }).notNull(),
  traceId: text('trace_id').notNull(),
    userId: text('user_id').references(() => users.id).notNull(),
    threadId: text('thread_id').references(() => chatThreads.id),
  triggerSource: text('trigger_source', {
    enum: ['ui', 'chat', 'assistant_action', 'api', 'system'],
  }).default('api').notNull(),
  status: text('status', {
    enum: ['queued', 'running', 'completed', 'failed', 'waiting_approval'],
  }).default('running').notNull(),
  inputPayload: jsonb('input_payload'),
  normalizedOutput: jsonb('normalized_output'),
  rawProviderResponse: jsonb('raw_provider_response'),
  errorPayload: jsonb('error_payload'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// =============================================================================
// APPROVALS DOMAIN
// =============================================================================

/**
 * Approval requests table.
 *
 * Human-in-the-loop approval workflow. When a workflow requires approval,
 * an approval record is created and the user must approve/reject before
 * execution continues.
 *
 * @remarks
 * - One approval per workflow run (1:1 relationship)
 * - summary: User-friendly description of what will be executed
 * - details: Structured data about the pending action
 *
 * @example
 * // Creating an approval request
 * await db.insert(approvals).values({
 *   id: generateId(),
 *   runId: 'run_123',
 *   userId: 'user_456',
 *   summary: 'Send email to john@example.com',
 *   details: { to: 'john@example.com', subject: 'Hello' },
 * });
 */
export const approvals = pgTable('approvals', {
  id: text('id').primaryKey(),
    runId: text('run_id').references(() => workflowRuns.id).notNull(),
    userId: text('user_id').references(() => users.id).notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).default('pending').notNull(),
  summary: text('summary').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

// =============================================================================
// NOTIFICATIONS DOMAIN
// =============================================================================

/**
 * In-app notifications table.
 *
 * Stores notifications for users about workflow events, approval requests,
 * and system messages. Rendered in the frontend notification center.
 *
 * @remarks
 * - read: Whether the user has seen this notification
 * - type: Categorization for filtering (workflow_event, approval_request, system)
 * - data: Arbitrary JSON payload for rendering
 *
 * @example
 * // Creating a notification
 * await db.insert(notifications).values({
 *   id: generateId(),
 *   userId: 'user_123',
 *   type: 'approval_request',
 *   title: 'Approval Required',
 *   message: 'Please review and approve the pending action',
 * });
 */
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id).notNull(),
    runId: text('run_id').references(() => workflowRuns.id),
  type: text('type', { enum: ['workflow_event', 'approval_request', 'system'] }).notNull(),
  title: text('title').notNull(),
  message: text('message'),
  read: boolean('read').default(false).notNull(),
  data: jsonb('data'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Web push subscriptions table.
 *
 * Stores browser push notification subscriptions for users.
 * Enables sending push notifications for workflow events and approvals.
 *
 * @remarks
 * - endpoint: Unique push service URL (VAPID)
 * - p256dh: Elliptic curve public key for encryption
 * - auth: Authentication secret for push messages
 * - revokedAt: Soft delete for inactive/invalid subscriptions
 *
 * @example
 * // Registering a push subscription
 * await db.insert(pushSubscriptions).values({
 *   id: generateId(),
 *   userId: 'user_123',
 *   endpoint: 'https://fcm.googleapis.com/fcm/send/...',
 *   p256dh: 'BASE64_ENCODED_PUBLIC_KEY',
 *   auth: 'BASE64_ENCODED_AUTH_SECRET',
 * });
 */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id).notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
});

// =============================================================================
// CONFIGURATION & CONNECTIONS
// =============================================================================

/**
 * AI provider configurations table.
 *
 * Stores LLM provider settings (OpenAI, Gemini, Ollama, etc.).
 * Supports multiple providers with one marked as default.
 *
 * @remarks
 * - apiKey: Stored encrypted at rest using PROVIDER_API_KEY_ENCRYPTION_KEY
 * - isDefault: Only one default provider active at a time
 * - baseUrl: Custom endpoint for self-hosted providers (Ollama)
 *
 * @example
 * // Setting up a Gemini provider
 * await db.insert(providerConfigs).values({
 *   id: generateId(),
 *   provider: 'gemini',
 *   model: 'gemini-1.5-pro',
 *   apiKey: encrypt('your-api-key'),
 *   isDefault: true,
 * });
 */
export const providerConfigs = pgTable('provider_configs', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  customName: text('custom_name'),
  model: text('model').notNull(),
  baseUrl: text('base_url'),
  apiKey: text('api_key'), // Encrypted or stored securely in prod
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Webhook authentication secrets table.
 *
 * Stores hashed secrets for verifying incoming webhook requests.
 * Enables secure webhook authentication without storing plaintext secrets.
 *
 * @remarks
 * - secretPrefix: First 8 characters shown for identification
 * - secretHash: bcrypt/argon2 hash of the full secret
 * - revokedAt: Soft delete for compromised secrets
 *
 * @example
 * // Creating a webhook secret
 * await db.insert(webhookSecrets).values({
 *   id: generateId(),
 *   label: 'Production webhook',
 *   secretPrefix: 'whsec_abc1',
 *   secretHash: await hashSecret(secret),
 * });
 */
export const webhookSecrets = pgTable('webhook_secrets', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  secretPrefix: text('secret_prefix').notNull(),
  secretHash: text('secret_hash').notNull().unique(),
    createdByUserId: text('created_by_user_id').references(() => users.id),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * External service connections table.
 *
 * Stores OAuth credentials and API keys for external services
 * (Google, Notion, Slack, etc.) connected by users.
 *
 * @remarks
 * - provider: Service identifier (e.g., 'google', 'notion', 'slack')
 * - credentials: Encrypted OAuth tokens/API keys
 *
 * @example
 * // Storing a Google OAuth connection
 * await db.insert(userConnections).values({
 *   id: generateId(),
 *   userId: 'user_123',
 *   provider: 'google',
 *   credentials: { access_token: '...', refresh_token: '...' },
 * });
 */
export const userConnections = pgTable('user_connections', {
  id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id).notNull(),
  provider: text('provider').notNull(), // e.g., 'google', 'notion'
  credentials: jsonb('credentials'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Authentication sessions table.
 *
 * Tracks active user sessions with secure token storage.
 * Supports session management and revocation.
 *
 * @remarks
 * - tokenHash: SHA-256 hash of the session token (never store raw token)
 * - expiresAt: Session expiration timestamp
 * - lastSeenAt: Updated on each authenticated request
 * - revokedAt: Soft delete for compromised/expired sessions
 *
 * @example
 * // Creating a session after login
 * await db.insert(authSessions).values({
 *   id: generateId(),
 *   userId: 'user_123',
 *   tokenHash: sha256(sessionToken),
 *   expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
 * });
 */
export const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at'),
  revokedAt: timestamp('revoked_at'),
  userAgent: text('user_agent'),
  ip: text('ip'),
}, (table) => [
  index('idx_auth_sessions_user').on(table.userId),
  index('idx_auth_sessions_expires').on(table.expiresAt),
]);

/**
 * Context memory table for retrieval-augmented assistant behavior.
 *
 * Stores compact conversation/workflow memories used by context-mode retrieval.
 * Records are category-tagged and can expire based on runtime retention policy.
 *
 * @remarks
 * - Intentionally avoids strict foreign keys for workflow/thread references to keep ingestion resilient.
 * - `metadata` holds provider-specific payloads for audit and ranking.
 * - Indexed by `(threadId, category)` to support fast scoped retrieval.
 *
 * @example
 * ```ts
 * await db.insert(contextMemory).values({
 *   id: 'mem_1',
 *   threadId: 'thread_123',
 *   userId: 'user_123',
 *   category: 'audit_event',
 *   content: 'Workflow execution requested by assistant.',
 *   summary: 'Assistant requested workflow run',
 * });
 * ```
 */
export const contextMemory = pgTable('context_memory', {
  id: text('id').primaryKey(),
  threadId: text('thread_id'),
  userId: text('user_id'),
  category: text('category', {
    enum: ['workflow_run', 'assistant_decision', 'thread_state', 'audit_event'],
  }).notNull(),

  // Source references (application-level integrity, no FK constraints)
  workflowRunId: text('workflow_run_id'),
  workflowId: text('workflow_id'),

  // Content
  content: text('content').notNull(),
  summary: text('summary'),
  metadata: jsonb('metadata'),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
}, (table) => [
  index('idx_context_memory_thread').on(table.threadId),
  index('idx_context_memory_category').on(table.category),
  index('idx_context_memory_thread_category').on(table.threadId, table.category),
  index('idx_context_memory_workflow_run').on(table.workflowRunId),
]);
