/**
 * @fileoverview Database seed runner for local/dev bootstrap.
 *
 * Seeds baseline data required to use the platform quickly after migrations:
 * - An admin user account
 * - Representative workflows across supported providers
 *
 * @remarks
 * This script is idempotent for seeded keys/emails through upsert logic.
 * It is intended for development environments, not production data loading.
 */
import { db } from './index';
import { users, workflows } from './schema';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

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
 * bun --filter backend run db:seed
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
        id: randomUUID(),
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
        id: randomUUID(),
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
        id: randomUUID(),
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
        id: randomUUID(),
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
        id: randomUUID(),
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
