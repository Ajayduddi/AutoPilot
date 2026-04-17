/**
 * @fileoverview Database seed runner for local/dev bootstrap.
 *
 * High-level purpose:
 * Database schema, bootstrap, and operational safety helpers for persistence runtime.
 *
 * Key Features (and trade-offs):
 * - Defines schema/migration/seed and lifecycle utilities.
 * - Supports preflight and integrity checks for production safety.
 * - Provides shared DB access primitives for repositories.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Follow migration safety workflow before schema changes.
 * 3. Keep destructive operations guarded and explicit.
 * 4. Validate with DB preflight/typecheck as applicable.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { db } from './index';
import { users, workflows } from './schema';
import * as dotenv from 'dotenv';
const envPath = decodeURIComponent(new URL('../../../../.env', import.meta.url).pathname);
dotenv.config({ path: envPath });

/**
 * Seeds baseline users and workflows into the database.
 *
 * @remarks
 * - Uses conflict-aware writes to avoid duplicate records on repeated runs.
 * - Refreshes mutable workflow fields (`description`, `tags`, `enabled`, etc.) when keys already exist.
 * - Exits process with status `0` on success and `1` on failure.
 *
 * @example
 * ```bash
 * bun --filter=backend run db:seed
 * ```
 */
async function seed() {
  console.log('🌱 Seeding database...');

  try {
    // Upsert admin user
    const [user] = await db.insert(users).values({
      id: 'usr_admin',
      email: 'admin@example.com',
      name: 'Admin User',
    }).onConflictDoUpdate({
      target: users.email,
      set: { name: 'Admin User' }
    }).returning();
    
    console.log(`✅ Seeded user: ${user.email}`);

    // ── Multi-provider sample workflows ──────────────────────────
    const n8nBase = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook';

    const sampleWorkflows = [
      {
        id: crypto.randomUUID(),
        key: 'wf_create_task',
        name: 'Create Task in Google Tasks',
        description: 'Creates a task based on naturally input text.',
        provider: 'n8n' as const,
        visibility: 'public' as const,
        ownerUserId: 'usr_admin',
        requiresApproval: false,
        triggerMethod: 'webhook' as const,
        executionEndpoint: `${n8nBase}/create-task`,
        authType: 'none' as const,
        tags: ['tasks', 'google', 'productivity'],
        enabled: true,
      },
      {
        id: crypto.randomUUID(),
        key: 'wf_scan_emails',
        name: 'Scan Important Emails',
        description: 'Finds important unread emails and summarizes them.',
        provider: 'n8n' as const,
        visibility: 'public' as const,
        ownerUserId: 'usr_admin',
        requiresApproval: true,
        triggerMethod: 'webhook' as const,
        executionEndpoint: `${n8nBase}/scan-emails`,
        authType: 'none' as const,
        tags: ['email', 'scanning', 'summary'],
        enabled: true,
      },
      {
        id: crypto.randomUUID(),
        key: 'wf_zapier_lead_enrich',
        name: 'Lead Enrichment',
        description: 'Enriches a lead record with contact information from Clearbit/Apollo.',
        provider: 'zapier' as const,
        visibility: 'public' as const,
        ownerUserId: 'usr_admin',
        requiresApproval: false,
        triggerMethod: 'webhook' as const,
        executionEndpoint: 'https://hooks.zapier.com/hooks/catch/example/lead-enrich',
        authType: 'none' as const,
        tags: ['crm', 'leads', 'enrichment'],
        enabled: true,
      },
      {
        id: crypto.randomUUID(),
        key: 'wf_make_daily_report',
        name: 'Daily Report Generator',
        description: 'Generates a daily summary report from multiple data sources.',
        provider: 'make' as const,
        visibility: 'private' as const,
        ownerUserId: 'usr_admin',
        requiresApproval: false,
        triggerMethod: 'webhook' as const,
        executionEndpoint: 'https://hook.eu1.make.com/example/daily-report',
        authType: 'bearer' as const,
        authConfig: { tokenRef: 'MAKE_API_TOKEN' },
        tags: ['reports', 'daily', 'analytics'],
        enabled: true,
      },
      {
        id: crypto.randomUUID(),
        key: 'wf_custom_invoice',
        name: 'Invoice Follow-Up',
        description: 'Sends follow-up reminders for overdue invoices via custom webhook.',
        provider: 'custom' as const,
        visibility: 'public' as const,
        ownerUserId: 'usr_admin',
        requiresApproval: true,
        triggerMethod: 'webhook' as const,
        executionEndpoint: 'https://internal.api.example.com/workflows/invoice-followup',
        authType: 'header_secret' as const,
        authConfig: { headerName: 'X-Webhook-Secret', secretRef: 'INVOICE_WEBHOOK_SECRET' },
        tags: ['invoices', 'billing', 'reminders'],
        enabled: true,
      },
    ];

    for (const wf of sampleWorkflows) {
      await db.insert(workflows).values(wf)
        .onConflictDoUpdate({
          target: workflows.key,
          set: {
            name: wf.name,
            description: wf.description,
            provider: wf.provider,
            visibility: wf.visibility,
            executionEndpoint: wf.executionEndpoint,
            authType: wf.authType,
            authConfig: wf.authConfig || null,
            tags: wf.tags,
            requiresApproval: wf.requiresApproval,
            enabled: wf.enabled,
            updatedAt: new Date(),
          },
        });
      console.log(`✅ Seeded workflow: ${wf.name} (${wf.provider})`);
    }

    console.log('🎉 Seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();
