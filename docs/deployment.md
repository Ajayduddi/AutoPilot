# AutoPilot Deployment Guide (Current)

This document reflects the current repository state.

## Prerequisites

- Bun 1.x
- PostgreSQL 16+ (or compatible managed Postgres)
- n8n (optional for local dev; required for n8n-backed workflows)

## 1) Environment Setup

```bash
cp .env.example .env
```

### Production-only required values

- `NODE_ENV=production`
- `DATABASE_URL`
- `AUTH_COOKIE_SECRET` (strong value, not default)
- `FRONTEND_ORIGIN`
- `OLLAMA_URL`
- `PROVIDER_API_KEY_ENCRYPTION_KEY` (>= 32 chars)
- `CALLBACK_BASE_URL`
- `WEBHOOK_CALLBACK_SECRET` or DB-managed webhook secrets

### Production runtime values

- `PORT` (default `3000`)
- `AUTOPILOT_HOME` (runtime home; default is `$HOME/.autopilot` if not set)
- `CALLBACK_BASE_URL` (public backend URL used for callback links)
- `FRONTEND_ORIGIN` (public frontend URL used for auth redirects and CORS)
- `OLLAMA_URL` (required explicitly in production even if you use a local/private Ollama deployment)
- `WEBHOOK_CALLBACK_SECRET` (fallback callback secret)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (for push notifications)
- `TRUST_PROXY` (set only when running behind a trusted reverse proxy/load balancer)
- `METRICS_AUTH_TOKEN` (required in production if metrics are not public)

## 2) Runtime Config (`config.json`)

Runtime config is read from:

- `${AUTOPILOT_HOME}/config.json`
- if `AUTOPILOT_HOME` is unset: `~/.autopilot/config.json`

Important keys:

- `approvalMode`: `"default"` | `"auto"`
- `forceInteractiveQuestions`: boolean
- `uploadDir`: string
- `DEFAULT_TIMEZONE`
- `OLLAMA_URL`
- `CONTEXT_MODE_*`
- `MAX_UPLOAD_MB`, `MAX_FILES_PER_MESSAGE`, `ALLOWED_MIME_TYPES`
- `AGENT_RUNTIME_*`
- `LLM_*` timeout keys
- `AUTO_ROUTER_*` breaker keys
- `ATTACHMENT_SCAN_*`
- `METRICS_*`
- `FEATURE_STRUCTURED_LOGGING`, `FEATURE_CROSS_ORIGIN_ISOLATION`

Reference implementation: `apps/backend/src/config/runtime.config.ts`

## 3) Database Workflow (Safe)

From `apps/backend`:

```bash
bun run db:preflight
bun run db:repair:analyze   # if preflight reports blocking issues
bun run db:repair:apply     # only after review
bun run db:generate         # when schema changed
bun run db:migrate
```

Notes:

- `db:push` is local/dev convenience and blocked in production mode.
- Keep snapshots/backups before destructive repair/migration steps.

## 4) Local Development

These localhost examples are for developer workstations only. They are not valid production guidance.

From repo root:

```bash
bun install
bun run dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Health: `http://localhost:3000/health`
- Readiness: `http://localhost:3000/health/ready`

Typical local-only env examples:

- `FRONTEND_ORIGIN=http://localhost:5173`
- `CALLBACK_BASE_URL=http://localhost:3000`
- `OLLAMA_URL=http://localhost:11434`

## 5) Production Container (Single Process)

Current Docker runtime is backend-only process with static frontend served by backend.

Build:

```bash
docker build -t autopilot:0.1.0 .
```

Run:

```bash
docker run -d \
  --name autopilot-0-1-0 \
  -p 3000:3000 \
  --env-file .env \
  -v autopilot_home:/home/autopilot/.autopilot \
  autopilot:0.1.0
```

Production notes:

- Use real public HTTPS origins for `FRONTEND_ORIGIN` and `CALLBACK_BASE_URL`.
- Do not rely on localhost fallbacks in production; backend startup now rejects that configuration.
- Keep CI/test-only secrets and localhost URLs out of production env files.

Container behavior:

- Backend listens on `:3000`
- `FRONTEND_STATIC_DIR=/app/public` (set in Dockerfile)
- Frontend static assets are served by backend
- Container runs as the non-root `autopilot` user
- Image exposes a built-in `/health`-based Docker `HEALTHCHECK`

Recommended runtime hardening:

- terminate TLS at a trusted reverse proxy or ingress
- set `TRUST_PROXY` only when that proxy is actually in front of the app
- mount `/home/autopilot/.autopilot` persistently so runtime config and generated state survive restarts
- prefer DB-managed webhook secrets over env fallback secrets
- keep `/health/ready` behind internal-only monitoring in production

If your platform supports it, prefer:

- `no-new-privileges`
- dropped Linux capabilities
- a read-only root filesystem plus writable mounts for:
  - `/home/autopilot/.autopilot`
  - `/tmp`

## 6) Webhook & Callback Integration

### n8n callback (legacy compatible)

- Endpoint: `POST /api/webhooks/n8n`
- Required header: `x-webhook-secret` (or legacy `x-n8n-secret`)
- Body:

```json
{
  "type": "completed",
  "runId": "run_123",
  "result": {}
}
```

### Unified callback (recommended)

- Endpoint: `POST /api/webhooks/callback`
- Required header: `x-webhook-secret`
- Body (typical):

```json
{
  "traceId": "trace_123",
  "workflowKey": "wf_portfolio",
  "provider": "n8n",
  "status": "completed",
  "result": {},
  "raw": {}
}
```

## 7) Production Checklist

- [ ] Required production env vars set and strong
- [ ] HTTPS + reverse proxy configured
- [ ] `TRUST_PROXY` matches real proxy topology and is not enabled unnecessarily
- [ ] DB preflight/repair/migrate completed
- [ ] Callback secrets configured (DB-generated keys preferred)
- [ ] `CALLBACK_BASE_URL` points to public backend URL
- [ ] Push VAPID keys configured if notifications are needed
- [ ] Runtime home is mounted persistently at `/home/autopilot/.autopilot`
- [ ] Metrics endpoint is private or protected with `METRICS_AUTH_TOKEN`
- [ ] `/health` and `/health/ready` both healthy post-deploy
