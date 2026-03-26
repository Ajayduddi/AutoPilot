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

# ─── n8n Integration ────────────────────────
N8N_WEBHOOK_URL=http://localhost:5678/webhook
N8N_CALLBACK_SECRET=your_strong_secret_here

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
# Run migrations
cd apps/backend
bun run db:migrate

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

---

## 4. n8n Wiring

### Triggering workflows
Configure each n8n workflow with a **Webhook** trigger node:
- Method: `POST`
- Path: e.g. `/create-task`
- The orchestrator will send:
```json
{
  "_meta": { "runId": "...", "workflowKey": "...", "userId": "usr_admin" },
  "text": "user-provided content"
}
```

### Sending results back
At the end of each n8n workflow, add an **HTTP Request** node:
- URL: `http://your-backend:3000/api/webhooks/n8n`
- Method: `POST`
- Header: `x-n8n-secret: <your N8N_CALLBACK_SECRET>`
- Body:
```json
{
  "type": "completed",
  "runId": "{{ $json._meta.runId }}",
  "result": { ... }
}
```

### Requesting human approval (optional)
To pause a workflow for user approval, add an **HTTP Request** node before the sensitive step:
- URL: `http://your-backend:3000/api/approvals`
- Method: `POST`
- Body:
```json
{
  "runId": "{{ $json._meta.runId }}",
  "userId": "usr_admin",
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
INSERT INTO workflows (key, display_name, description, n8n_webhook_url, enabled)
VALUES ('wf_my_flow', 'My New Flow', 'What it does', 'http://n8n/webhook/my-flow', true);
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
- [ ] Use a strong, unique `N8N_CALLBACK_SECRET`
- [ ] Serve behind a reverse proxy (nginx/caddy) with HTTPS
- [ ] Point `DATABASE_URL` to a managed Postgres instance
- [ ] Generate real PWA icons (192x192 and 512x512 PNGs) in `public/icons/`
- [ ] Set n8n webhook URLs to the public backend domain
