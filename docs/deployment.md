# AutoPilot — Deployment Guide

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- PostgreSQL (local or hosted)
- n8n (self-hosted or cloud) — optional for local dev
- Node ≥ 18 (for some tooling)

---

## 1. Environment Setup

Copy the example and fill in values:
```bash
cp .env.example .env
```

### Root `.env` variables

```bash
# ─── Database ───────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/autopilot

# ─── Backend ────────────────────────────────
PORT=3000
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173

# ─── Authentication / Sessions ──────────────
AUTH_COOKIE_SECRET=change-this-secret
SESSION_TTL_DAYS=14
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# ─── Provider Callback Security ─────────────
# Optional fallback secret. Preferred approach:
# generate callback keys in Settings > Webhook Callbacks.
WEBHOOK_CALLBACK_SECRET=your_strong_secret_here

# Public base URL for callback links emitted to providers
CALLBACK_BASE_URL=http://localhost:3000

# Optional: used only by seed script for sample n8n workflows
N8N_WEBHOOK_URL=http://localhost:5678/webhook

# ─── LLM Provider (Ollama default) ──────────
OLLAMA_URL=http://localhost:11434

# ─── Optional: Cloud LLM keys ───────────────
# GEMINI_API_KEY=your_gemini_key
# GROQ_API_KEY=your_groq_key
# MISTRAL_API_KEY=your_mistral_key
```

---

## 2. Database Setup

```bash
# Generate migrations from schema (when schema changes)
cd apps/backend
bun run db:generate

# Apply schema to DB
bun run db:push

# Seed development data (admin user + sample workflows)
bun run db:seed
```

---

## 3. Running Locally

From the monorepo root:
```bash
bun run dev
```
This starts both:
- **Frontend** → http://localhost:5173
- **Backend** → http://localhost:3000

Verify the backend is healthy:
```bash
curl http://localhost:3000/health
```

First run uses onboarding:
- open `http://localhost:5173/onboarding`
- create the owner account
- sign-up is locked after first account (single-user mode)

---

## 4. Provider Webhook Wiring

Execution endpoints are configured per workflow when you create/edit workflows.
Use the callback endpoints below for providers to send run status/results back to this platform.

### Triggering workflows (per workflow endpoint)
Configure each n8n workflow with a **Webhook** trigger node:
- Method: `POST`
- Path: e.g. `/create-task`
- The orchestrator will send:
```json
{
  "_meta": { "runId": "...", "workflowKey": "...", "userId": "<current_user_id>" },
  "text": "user-provided content"
}
```

### Sending results back
At the end of each n8n workflow, add an **HTTP Request** node:
- URL: `http://your-backend:3000/api/webhooks/n8n`
- Method: `POST`
- Header: `x-webhook-secret: <generated_callback_key>`
- Alternative header (backward-compatible): `x-n8n-secret`
- Body:
```json
{
  "type": "completed",
  "runId": "{{ $json._meta.runId }}",
  "result": { ... }
}
```

### Unified callback (non-n8n or custom adapters)
- URL: `http://your-backend:3000/api/webhooks/callback`
- Method: `POST`
- Header: `x-webhook-secret: <generated_callback_key>`
- Body shape: `traceId`, `workflowKey`, `provider`, `status`, `result/raw/error`

Example:
```bash
curl -X POST "http://localhost:3000/api/webhooks/callback" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: whsec_your_generated_key_here" \
  -d '{
    "traceId": "trace_123",
    "workflowKey": "wf_portfolio",
    "provider": "n8n",
    "status": "completed",
    "result": { "message": "done" },
    "raw": { "providerRunId": "abc123" }
  }'
```

Legacy n8n callback example:
```bash
curl -X POST "http://localhost:3000/api/webhooks/n8n" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: whsec_your_generated_key_here" \
  -d '{
    "type": "completed",
    "runId": "run_123",
    "result": { "message": "done" }
  }'
```

### Requesting human approval (optional)
To pause a workflow for user approval, add an **HTTP Request** node before the sensitive step:
- URL: `http://your-backend:3000/api/approvals`
- Method: `POST`
- Body:
```json
{
  "runId": "{{ $json._meta.runId }}",
  "userId": "<current_user_id>",
  "summary": "Please confirm: delete 3 archived emails",
  "details": {}
}
```
Then add a **Wait** node. When the user approves via the UI, n8n resumes from the Wait node's resume URL.

---

## 5. Adding a New Workflow

1. Create the workflow in n8n and copy its webhook URL
2. Run the seed script or insert directly:
```sql
INSERT INTO workflows (id, key, name, description, provider, visibility, trigger_method, execution_endpoint, enabled)
VALUES (
  'wf_my_flow_id',
  'wf_my_flow',
  'My New Flow',
  'What it does',
  'n8n',
  'public',
  'webhook',
  'http://n8n/webhook/my-flow',
  true
);
```
3. The orchestrator's LLM parser will now propose this workflow when user intent matches

---

## 6. Switching AI Provider

Update the `provider_configs` table:
```sql
-- Set Gemini as default
UPDATE provider_configs SET is_default = false;
INSERT INTO provider_configs (id, provider, model, api_key, is_default)
VALUES ('cfg_gemini', 'gemini', 'gemini-1.5-flash', 'your_api_key', true);
```
The `LLMFactory` auto-reads this on each request — no restart needed.

---

## 7. Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Generate callback keys in Settings and store them in your provider securely
- [ ] (Optional fallback) set a strong `WEBHOOK_CALLBACK_SECRET`
- [ ] Serve behind a reverse proxy (nginx/caddy) with HTTPS
- [ ] Point `DATABASE_URL` to a managed Postgres instance
- [ ] Generate real PWA icons (192x192 and 512x512 PNGs) in `public/icons/`
- [ ] Set n8n webhook URLs to the public backend domain
