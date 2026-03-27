import { pgTable, text, timestamp, boolean, jsonb, integer, index } from 'drizzle-orm/pg-core';

// --- Users ---
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name'),
  passwordHash: text('password_hash'),
  googleSub: text('google_sub').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Chat ---
export const chatThreads = pgTable('chat_threads', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').references(() => chatThreads.id).notNull(),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content'), // Plain text fallback
  blocks: jsonb('blocks'), // Rich UI blocks array
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Workflows (Unified Multi-Provider) ---
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

// --- Workflow Runs ---
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

// --- Approvals ---
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

// --- Notifications ---
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

// --- Configs & Connections ---
export const providerConfigs = pgTable('provider_configs', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  baseUrl: text('base_url'),
  apiKey: text('api_key'), // Encrypted or stored securely in prod
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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

export const userConnections = pgTable('user_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  provider: text('provider').notNull(), // e.g., 'google', 'notion'
  credentials: jsonb('credentials'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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

// --- Context Memory (context-mode integration) ---
export const contextMemory = pgTable('context_memory', {
  id: text('id').primaryKey(),
  threadId: text('thread_id'),
  userId: text('user_id'),
  category: text('category', {
    enum: ['workflow_run', 'assistant_decision', 'thread_state'],
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
