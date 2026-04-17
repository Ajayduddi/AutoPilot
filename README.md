<div align="center">
<p align="center" style="margin-bottom: 0">
  <img src="README.svg" alt="AutoPilot" width="240" height="50" />
</p>

<p align="center"><strong>Chat-First Automation Platform</strong></p>
<p align="center"><em>Conversational control center for workflows, agents, and automations</em></p>

<p align="center">
  <a href="https://hub.docker.com/r/ajayduddi/autopilot"><img src="https://img.shields.io/badge/Docker-ajayduddi%2Fautopilot-blue?logo=docker" alt="Docker"></a>
  <!-- <img src="https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun" alt="Bun">
  <img src="https://img.shields.io/badge/Frontend-SolidJS-2c4f7c?logo=solid" alt="SolidJS">
  <img src="https://img.shields.io/badge/Database-PostgreSQL-336791?logo=postgresql" alt="PostgreSQL"> -->
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-green.svg" alt="License"></a>
</p>

</div>

---

## 📋 Overview

AutoPilot is a self-hosted, chat-first automation platform. Instead of manual triggers and complex dashboards, you interact with your automations through natural language. It connects to multiple workflow providers (n8n, Make, Zapier, custom webhooks) and LLM providers, giving you a unified conversational interface for execution, monitoring, file processing, and approval workflows.

---

## ✨ Features

### AI-Powered Chat
- Natural language workflow control with real-time SSE streaming
- Mastra-based agent runtime with deterministic orchestrator fallback
- Multi-step ReAct agent loop with tool calls (workflow execution, approvals, context retrieval)
- Context-aware memory across threads with pgvector-backed retrieval
- MCP (Model Context Protocol) support for external tool integrations

### Auto Model Router
- Automatically discovers available models across all configured LLM providers
- Scores and ranks candidates by quality, latency, and health stats
- Circuit breaker per provider — failed providers cool down before retries
- Prefers reasoning-capable models for complex turns

### Workflow Providers
| Provider | Type |
|---|---|
| n8n | Self-hosted / cloud |
| Make (Integromat) | Cloud scenarios |
| Zapier | Webhook Zaps |
| Custom HTTP | Any webhook endpoint |
| Simulator | Local testing (no external dependency) |

### LLM Providers
| Provider | Notes |
|---|---|
| OpenAI | GPT-4o, GPT-4o-mini, and any compatible model |
| Google Gemini | Gemini 2.5 Flash and others |
| Ollama | Self-hosted Llama, Mistral, etc. |
| Groq | Fast inference |
| Mistral | European models + Mistral OCR for PDF/image extraction |
| OpenAI-Compatible | Any provider with an OpenAI-compatible API |

### Embeddings & Semantic Search
- pgvector in PostgreSQL — no separate vector DB required
- Indexes: workflows, workflow runs, document chunks
- Embedding providers: Gemini, BGE-small (local), all-MiniLM-L6-v2 (local)
- RAG: retrieval-augmented responses grounded in uploaded documents
- Semantic search APIs for workflows, runs, and attachments
- Similar workflow and related run recommendations

### File Attachments
- Upload documents (PDF, Word, Excel, PowerPoint, images, audio, text, JSON, XML)
- Automatic text extraction, chunking, and embedding
- Provider-agnostic OCR chain: configured LLM → Mistral OCR → local fallback
- Virus scanning: ClamAV (daemon) or HTTP-based scanner
- Up to 25 MB per file, 6 files per message (configurable)

### Approvals
- Approval-gated workflow execution paths
- In-app approval queue with in-browser and web push notifications
- Auto-approval mode configurable per deployment

### Notifications
- Server-Sent Events (SSE) for real-time in-app updates
- Web Push (VAPID) for browser notifications
- Per-thread notification tracking

### Authentication & Security
- Email/password + Google OAuth sign-in
- TOTP-based MFA (optional per user)
- AES-256-GCM encrypted API key storage
- CSRF protection, rate limiting, security headers
- Webhook HMAC signature verification
- Structured request tracing middleware

### Observability
- Prometheus-compatible metrics via `/health/metrics` (auth-gated)
- Prometheus Pushgateway support
- Runtime telemetry for ReAct agent loop steps
- Health and readiness endpoints: `/health`, `/health/ready`

---

## 🚀 Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- PostgreSQL 16+ (or use Docker Compose below)

### Docker Run

```bash
# Pull the image
docker pull ajayduddi/autopilot:latest

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your actual values (database, secrets, callbacks)

# Run with environment file
docker run -d \
  --name autopilot \
  -p 3000:3000 \
  --env-file .env \
  ajayduddi/autopilot:latest
```

### Docker Compose

Create a `docker-compose.yml` file:

```yaml
services:
  autopilot:
    image: ajayduddi/autopilot:latest
    restart: always
    env_file: .env.docker
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@db:5432/${POSTGRES_DB:-autopilot}
    depends_on: [db]
    command: >
      sh -c "bun /app/apps/backend/dist/db/migrate.js &&
             bun /app/apps/backend/dist/index.js"
    ports:
      - "3000:3000"
    volumes:
      - autopilot_data:/data

  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: autopilot
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  autopilot_data:
  postgres_data:
```

Then run:

```bash
# Create compose-specific env file
cp .env.example .env.docker

# Keep DB credentials in one place for both services
echo "POSTGRES_USER=postgres" >> .env.docker
echo "POSTGRES_PASSWORD=postgres" >> .env.docker
echo "POSTGRES_DB=autopilot" >> .env.docker

# Remove DATABASE_URL from .env.docker if present;
# compose builds it from POSTGRES_* and service hostname 'db'.

# Start services
docker compose up -d
```

> **Note:** Use `pgvector/pgvector:pg16` (not plain `postgres:16`) so the `vector` extension is available for semantic search and RAG.

---

## ⚙️ Environment Variables

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_COOKIE_SECRET` | Session cookie signing secret (32+ chars) |
| `PROVIDER_API_KEY_ENCRYPTION_KEY` | AES-256-GCM key for stored API keys (32+ chars) |
| `WEBHOOK_CALLBACK_SECRET` | Fallback HMAC secret for webhook callbacks (32+ chars) |
| `CALLBACK_BASE_URL` | Public HTTPS URL for receiving workflow callbacks |
| `FRONTEND_ORIGIN` | Public HTTPS URL for CORS and OAuth redirects |
| `VITE_API_URL` | Backend API base URL used by frontend at build time |

### 🔐 Authentication

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | — | Must be `<FRONTEND_ORIGIN>/api/auth/google/callback` |
| `SESSION_TTL_DAYS` | `14` | Session lifetime in days |
| `TRUST_PROXY` | — | Set to `1` when behind a reverse proxy |

### 🔔 Push Notifications (optional)

```bash
# Generate VAPID keys once:
npx web-push generate-vapid-keys

VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

### 🛡️ File Scanning (optional)

| Variable | Description |
|---|---|
| `CLAMAV_HOST` | ClamAV daemon host |
| `CLAMAV_PORT` | ClamAV daemon port (default `3310`) |
| `ATTACHMENT_SCAN_HTTP_URL` | Alternative HTTP-based scanner endpoint |
| `ATTACHMENT_SCAN_HTTP_TOKEN` | Bearer token for HTTP scanner |

### 🧪 Stability Rollout Flags (Compatibility-First)

| Flag | Default | What it controls |
|---|---|---|
| `FEATURE_STRUCTURED_LOGGING` | `false` | Enables structured logging format for operational observability pipelines. |
| `FEATURE_CROSS_ORIGIN_ISOLATION` | `false` | Enables cross-origin isolation headers/behavior for advanced browser runtime features. |


### 🔎 Embeddings & RAG (optional)

| Variable | Default | Description |
|---|---|---|
| `EMBEDDING_PROVIDER` | `api` | `api`, `bge_local`, or `minilm_local` |
| `EMBEDDING_MODEL` | `text-embedding-004` | Model ID for the selected provider |
| `SEMANTIC_SEARCH_TOP_K_DEFAULT` | `8` | Results returned per semantic query |
| `SEMANTIC_SEARCH_MIN_SCORE` | `0.65` | Minimum cosine similarity threshold |
| `RAG_MAX_CHUNKS` | `8` | Max chunks injected into assistant context |
| `RAG_CHUNK_TOKEN_BUDGET` | `2400` | Token budget for grounded context |

**Local embeddings (no Gemini API key needed):**
```bash
EMBEDDING_PROVIDER=bge_local
EMBEDDING_MODEL=Xenova/bge-small-en-v1.5

# MiniLM
EMBEDDING_PROVIDER=minilm_local
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
```

---

## 🧭 Runtime Configuration

Advanced settings live in `~/.autopilot/config.json` (path set by `AUTOPILOT_HOME`). Key options:

```json
{
  "uploadDir": "./uploads",
  "approvalMode": "default",
  "OLLAMA_URL": "http://ollama.internal:11434",
  "AGENT_RUNTIME_MAX_STEPS": 6,
  "AGENT_MCP_ENABLED": false,
  "AGENT_MCP_SERVERS_JSON": {},
  "MAX_UPLOAD_MB": 25,
  "MAX_FILES_PER_MESSAGE": 6,
  "CONTEXT_MODE_ENABLED": true,
  "CONTEXT_MODE_TARGET_WINDOW_TOKENS": 250000,
  "CONTEXT_MODE_HISTORY_BUDGET_TOKENS": 160000,
  "CONTEXT_MODE_TTL_DAYS": 30,
  "LLM_GENERATE_REPLY_TIMEOUT_MS": 30000,
  "AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES": 3,
  "ATTACHMENT_SCAN_MODE": "off",
  "METRICS_ALLOW_PUBLIC": false,
  "METRICS_AUTH_TOKEN": ""
}
```

> `/health/metrics` is private by default. Set `METRICS_AUTH_TOKEN` for authenticated Prometheus scraping, or keep it behind private network access.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Browser (SolidJS)                      │
│   Chat · Threads · Workflows · Approvals · Notifications |
│                       Settings                           │
└───────────────────────┬──────────────────────────────────┘
                        │ REST + SSE
                ┌───────▼────────┐
                │  Express API   │
                │   (Bun)        │
                └───────┬────────┘
         ┌──────────────┼──────────────────┐
         │              │                  │
  ┌──────▼──────┐ ┌─────▼──────┐  ┌───────▼───────┐
  │ PostgreSQL  │ │  Workflow  │  │  LLM Provider │
  │ + pgvector  │ │  Adapters  │  │  (Auto-Router)│
  │  (Drizzle)  │ │ n8n/Make/  │  │ OpenAI/Gemini │
  └─────────────┘ │ Zapier/... │  │ Ollama/Groq/..│
                  └─────┬──────┘  └───────────────┘
                        │ callbacks
              ┌─────────▼──────────┐
              │  /api/webhooks/*   │
              └────────────────────┘
```

### Runtime Model

Every chat message goes through a two-tier runtime:

1. **`AgentService`** (primary) — Mastra-based ReAct agent with tool calls: workflow execution, approval handling, context/memory retrieval, system queries
2. **`OrchestratorService`** (fallback) — deterministic intent-parse + reply-generate path when the agent runtime fails or times out

Streaming uses SSE. Non-streaming uses regular JSON responses. Both paths produce identical structured block output.

---

## 🛠️ Development

### 🧑‍💻 Local Setup

```bash
git clone https://github.com/Ajayduddi/AutoPilot.git && cd autopilot
bun install

# Environment
cp .env.example .env
# Edit .env with your credentials

# Database setup
bun --filter=backend run db:preflight
bun --filter=backend run db:migrate

# Start everything
bun run dev
```

**Default URLs:**
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`
- Health: `http://localhost:3000/health`

### ⌨️ Commands

```bash
bun run dev           # Start frontend + backend in watch mode
bun run build         # Build all workspaces
bun run typecheck     # TypeScript check across all workspaces
bun run test          # Run all tests
bun run lint          # Lint backend

# Backend DB workflow
bun --filter=backend run db:preflight     # Validate DB connectivity + extension
bun --filter=backend run db:generate      # Generate migration from schema diff
bun --filter=backend run db:migrate       # Apply pending migrations
bun --filter=backend run db:seed          # Seed development data
bun --filter=backend run db:repair        # Analyze + repair migration journal
```

### 🗄️ Database Safety

Production schema changes must follow this order:

1. `db:preflight` — verify DB connection and pgvector extension
2. `db:repair:analyze` / `db:repair:apply` — fix journal if needed
3. `db:generate` — generate migration SQL from Drizzle schema diff
4. `db:migrate` — apply to target database

`db:push` is blocked in production (use `db:push:guarded` only for local dev).

### 📁 Project Structure

```
apps/
  backend/src/
    config/          # Runtime config loading, schema, persistence
    db/              # Drizzle schema, migrations, seed, preflight, repair
    middleware/       # auth, csrf, rate-limit, security-headers, webhooks, tracing
    providers/
      llm/           # OpenAI, Gemini, Ollama providers + LLMFactory
      workflow/      # n8n, Make, Zapier, Custom, Sim adapters
      embedding/     # Gemini, BGE-local, MiniLM, OpenAI-compatible
    routes/          # Express route handlers
    repositories/    # Data access layer (Drizzle queries)
    services/
      agent/         # Mastra ReAct agent orchestration
      agent-runtime/ # MCP, tools (workflow/approval/context/system)
      ai-routing/    # Auto model router with circuit breaker
      orchestrator/  # Deterministic fallback orchestrator
      context/       # Thread context window assembly
      retrieval/     # Embeddings, RAG, semantic search, recommendations
      attachments/   # Upload processing, OCR, scanning
      notifications/ # SSE events, web push
      auth/          # Session management, Google OAuth, MFA
      settings/      # Provider config management
      extraction/    # Document parsing and chunking
      telemetry/     # ReAct step telemetry
      workflow/      # Workflow CRUD and run management
  frontend/src/
    routes/          # Chat, threads, workflows, approvals, notifications, settings
    components/      # chat/, layout/, notifications/, settings/, workflow/, ui/
    context/         # Auth, notifications, mobile menu, theme contexts
    lib/             # API client, utilities
packages/
  shared/src/        # Shared TypeScript types: chat blocks, API contracts, workflows
```

---

## 🔌 Webhook Integration

AutoPilot receives completion callbacks from workflow providers at:

```
POST /api/webhooks/callback 
```

All endpoints verify `x-webhook-secret` HMAC. Secrets are managed per-callback-key from **Settings → Webhook Callbacks**.

**Universal callback format:**
```json
{
  "traceId": "trace_abc123",
  "workflowKey": "daily_report",
  "provider": "n8n",
  "status": "completed",
  "result": { }
}
```

---

## 🩺 Troubleshooting

**Container won't start**
```bash
# Check logs
docker logs autopilot
```
Check `DATABASE_URL`, `AUTH_COOKIE_SECRET`, and `PROVIDER_API_KEY_ENCRYPTION_KEY` are all set.

**pgvector extension missing**
Use `pgvector/pgvector:pg16` image (not plain `postgres:16`), or run `CREATE EXTENSION vector;` manually, then re-run `db:preflight`.

**Webhook callbacks not arriving**
- Verify `CALLBACK_BASE_URL` is a publicly reachable HTTPS URL
- Check webhook secret matches the configured key in Settings
- Confirm ingress/firewall allows `POST /api/webhooks/*`

**LLM errors**
- Verify API key in Settings → AI Providers
- For Ollama: ensure `OLLAMA_URL` points to a running Ollama instance accessible from the container
- Check model name is correct for the configured provider

**Embeddings not working**
- `EMBEDDING_PROVIDER=gemini` requires a Gemini API key configured in Settings
- For local providers, first run may download model weights (~100 MB)
- After changing providers, reindex embeddings from Settings → Retrieval

---

## 📚 Documentation

- [Architecture](docs/architecture.md) — runtime model, component map, request flows
- [Deployment Guide](docs/deployment.md) — production deployment details
- [API Reference](docs/api-reference.md) — endpoint documentation
- [Migrations](docs/migrations.md) — database migration workflow
- [DB Migration Safety](apps/backend/docs/db-migration-safety.md) — migration safety rules
- [Model Policy](apps/backend/docs/model-policy.md) — LLM provider and model policies
- [n8n Contract](apps/backend/docs/n8n-contract.md) — n8n webhook integration contract

---

## 📄 License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

