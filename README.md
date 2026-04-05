<div align="center">

<h1 style="display:flex;align-items:center;justify-content:center;gap:0;margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-weight:600;letter-spacing:-0.01em;">
  <img src="apps/frontend/public/icons/icon-192.svg" alt="AutoPilot icon" width="40" height="40" />
  <span>AutoPilot</span>
</h1>

**Chat-First Automation Platform**  
*Conversational control center for workflows, agents, and automations*

[![Docker](https://img.shields.io/badge/Docker-ajayduddi%2Fautopilot-blue?logo=docker)](https://hub.docker.com/r/ajayduddi/autopilot)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)

</div>

---

## 📋 Overview

AutoPilot transforms how you interact with automation workflows. Instead of manual triggers and complex dashboards, simply **chat** with your automations. It connects to multiple workflow providers and LLMs, giving you a unified conversational interface for execution, monitoring, and approval workflows.

## ✨ Features

### 🤖 AI-Powered Chat Interface
- **Natural Language Control** - Trigger and manage workflows through conversation
- **Streaming Responses** - Real-time SSE streaming for assistant replies
- **Rich Message Blocks** - Render summaries, email drafts, questions, and source references
- **Context Memory** - Intelligent conversation context across threads

### 🔌 Multi-Provider Workflow Support
Connect to your existing automation infrastructure:
- **n8n** - Self-hosted or cloud n8n instances
- **Zapier** - Zapier webhooks and Zaps
- **Make** (Integromat) - Scenario execution
- **Custom HTTP** - Generic webhook endpoints
- **Simulator** - Test workflows without external dependencies

### 🧠 Flexible LLM Integration
Switch between providers based on your needs:
- **OpenAI** (GPT-4o, GPT-4o-mini)
- **Google Gemini** (Gemini 2.5 Flash)
- **Ollama** - Self-hosted models (Llama, Mistral, etc.)
- **Groq** - Fast inference
- **Mistral** - European AI models

### 🔔 Real-Time Notifications
- **Web Push** - Browser notifications for workflow events
- **SSE Streams** - Live updates in the chat interface
- **Approval Requests** - In-app and push notification approvals

### 📎 File Attachments
- Upload documents for AI processing
- Automatic text extraction and chunking
- MIME type validation and virus scanning (ClamAV)
- Structured metadata extraction

### 🔐 Security-First
- Google OAuth + session-based authentication
- Encrypted API key storage (AES-256-GCM)
- CSRF protection, rate limiting, security headers
- Webhook signature verification

## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed
- PostgreSQL 16+ (or use Docker Compose with included services)

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

### Environment Configuration

Create a `.env` file with the following (copy from `.env.example`):

```bash
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/autopilot
FRONTEND_ORIGIN=https://your-domain.com
AUTOPILOT_HOME=/home/<your-username>/.autopilot
NODE_ENV=production

# ─── Authentication / Sessions ──────────────────────────────
AUTH_COOKIE_SECRET=change-this-secret
SESSION_TTL_DAYS=14
AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE=true
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-domain.com/api/auth/google/callback

# ─── Workflow / Webhook Integration ─────────────────────────
# All workflow execution endpoints are configured per workflow in the UI.
# Optional fallback secret for provider callbacks to /api/webhooks/*.
# Preferred: generate/revoke keys from Settings > Webhook Callbacks.
WEBHOOK_CALLBACK_SECRET=change-me
CALLBACK_BASE_URL=https://your-domain.com

# ─── LLM Provider Defaults ──────────────────────────────────
PROVIDER_API_KEY_ENCRYPTION_KEY=change-this-32-byte-secret
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
ATTACHMENT_SCAN_HTTP_URL=
ATTACHMENT_SCAN_HTTP_TOKEN=

# ─── Stability Rollout Flags (Compatibility-First) ──────────
# Keep disabled by default to preserve current behavior.
FEATURE_TYPED_CONTRACTS=false
FEATURE_STRUCTURED_LOGGING=false

# ─── Web Push (WhatsApp/Telegram-style browser push) ────────
# Generate once and keep stable in production:
#   npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:example@example.com
```

### Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  autopilot:
    image: ajayduddi/autopilot:latest
    ports:
      - "3000:3000"
    env_file: .env.docker
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@db:5432/${POSTGRES_DB:-autopilot}
    depends_on:
      - db
    volumes:
      - autopilot_data:/data

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=autopilot
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

**Note on Single-Server Architecture:**

In Docker, AutoPilot runs as a single process where the backend serves the static frontend directly. Even though both run on the same server, you must still configure:

| Variable | Why Required |
|----------|-------------|
| `FRONTEND_ORIGIN` | OAuth callbacks (Google login redirects) and CORS headers |
| `CALLBACK_BASE_URL` | Webhook callbacks from workflow providers |

**Example production setup:**

```bash
# Your public domain
FRONTEND_ORIGIN=https://your-domain.com
CALLBACK_BASE_URL=https://your-domain.com
GOOGLE_REDIRECT_URI=https://your-domain.com/api/auth/google/callback
```

## ⚙️ Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_COOKIE_SECRET` | Secret for session cookie signing (32+ chars) |
| `PROVIDER_API_KEY_ENCRYPTION_KEY` | Key for encrypting stored API keys (32+ chars) |
| `CALLBACK_BASE_URL` | Public URL for webhook callbacks |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `FRONTEND_ORIGIN` | - | CORS origin for frontend |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth client secret |
| `WEBHOOK_CALLBACK_SECRET` | - | Fallback webhook verification secret |
| `VAPID_PUBLIC_KEY` | - | Web Push public key |
| `VAPID_PRIVATE_KEY` | - | Web Push private key |
| `VAPID_SUBJECT` | - | Web Push contact email |

### Runtime Config

Advanced configuration via `~/.autopilot/config.json`:

```json
{
  "uploadDir": "./uploads",
  "approvalMode": "default",
  "DEFAULT_TIMEZONE": "UTC",
  "ALLOW_PRIVATE_MODEL_FETCH": true,
  "MODEL_FETCH_TIMEOUT_MS": 10000,
  "MAX_MODEL_FETCH_BYTES": 2097152,
  "OLLAMA_URL": "http://localhost:11434",
  "CONTEXT_MODE_ENABLED": true,
  "CONTEXT_MODE_DEBUG": false,
  "CONTEXT_MODE_MAX_RETRIEVAL": 24,
  "CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON": {
    "gpt-4o": 24,
    "gpt-4o-mini": 32,
    "gemini-1.5-pro": 40,
    "llama3": 20,
    "mistral": 28,
    "*": 24
  },
  "CONTEXT_MODE_CONTENT_MAX_LEN": 120000,
  "CONTEXT_MODE_SUMMARY_MAX_LEN": 300,
  "CONTEXT_MODE_TARGET_WINDOW_TOKENS": 250000,
  "CONTEXT_MODE_HISTORY_BUDGET_TOKENS": 160000,
  "CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS": 70000,
  "CONTEXT_MODE_MAX_MESSAGE_TOKENS": 12000,
  "CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS": 18000,
  "CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS": 48000,
  "CONTEXT_MODE_INDEX_WORKFLOW_RUNS": true,
  "CONTEXT_MODE_INDEX_DECISIONS": true,
  "CONTEXT_MODE_INDEX_THREAD_STATE": true,
  "CONTEXT_MODE_TTL_DAYS": 30,
  "CONTEXT_MODE_CACHE_ANSWER": true,
  "CONTEXT_MODE_CACHE_STALE_MINS": 15,
  "MAX_UPLOAD_MB": 25,
  "MAX_FILES_PER_MESSAGE": 6,
  "ALLOWED_MIME_TYPES": [
    "image/*",
    "audio/*",
    "text/*",
    "application/json",
    "application/xml",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ],
  "ATTACHMENT_PROCESS_TIMEOUT_MS": 120000,
  "AGENT_RUNTIME_MAX_STEPS": 6,
  "MASTRA_AGENT_MODEL": "",
  "AGENT_MCP_ENABLED": false,
  "AGENT_MCP_SERVERS_JSON": {},
  "AGENT_MCP_TIMEOUT_MS": 15000,
  "LLM_PARSE_INTENT_TIMEOUT_MS": 12000,
  "LLM_GENERATE_REPLY_TIMEOUT_MS": 30000,
  "LLM_STREAM_STALL_TIMEOUT_MS": 12000,
  "AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES": 3,
  "AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS": 45000,
  "ATTACHMENT_SCAN_MODE": "off",
  "ATTACHMENT_SCAN_FAIL_CLOSED": false,
  "ATTACHMENT_SCAN_TIMEOUT_MS": 5000,
  "METRICS_PUSHGATEWAY_URL": "",
  "METRICS_JOB_NAME": "autopilot-backend",
  "METRICS_INSTANCE_ID": "",
  "METRICS_PUSH_INTERVAL_MS": 15000,
  "METRICS_PUSH_TIMEOUT_MS": 5000,
  "METRICS_SNAPSHOT_PATH": ""
}
```

## 📖 Usage Guide

### 1. Initial Setup

Access the UI at `http://localhost:3000` and complete the setup:

1. **Configure LLM Provider** - Go to Settings → AI Providers
   - Add your OpenAI, Gemini, or Ollama credentials
   - Set a default provider

2. **Connect Workflow Providers** - Settings → Workflow Providers
   - Add n8n webhook URL
   - Configure Zapier/Make credentials
   - Set up custom endpoints

3. **Configure Authentication** - Enable Google OAuth or use local auth

### 2. Creating Workflows

Navigate to **Workflows** → **New Workflow**:

```yaml
Key: daily_report
Name: Daily Analytics Report
Provider: n8n
Execution Endpoint: https://n8n.example.com/webhook/daily-report
Method: POST
Requires Approval: true  # Enable approval gates
```

### 3. Chat Interaction

In the **Chat** interface:

```
User: Run the daily report for yesterday
Assistant: I'll trigger the daily report workflow for you.
       [Workflow triggered: daily_report]
       Status: waiting_approval

User: Approve it
Assistant: Approved and running... ✓
       Workflow completed successfully.
       [View Results]
```

### 4. Webhook Integration

AutoPilot receives workflow completion callbacks:

**n8n Webhook Node:**
```javascript
// HTTP Request node configuration
Method: POST
URL: https://autopilot.example.com/api/webhooks/n8n
Headers: {
  "x-webhook-secret": "your-secret"
}
Body: {
  "type": "completed",
  "runId": "{{ $runId }}",
  "result": {{ $json }}
}
```

**Universal Callback:**
```javascript
POST /api/webhooks/callback
Headers: x-webhook-secret: <secret>
Body: {
  "traceId": "trace_123",
  "workflowKey": "daily_report",
  "provider": "n8n",
  "status": "completed",
  "result": { ... }
}
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (SolidJS)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │  Chat UI    │  │ Workflows   │  │ Settings/Providers  │   │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘   │
└─────────┼────────────────┼────────────────────┼──────────────┘
          │                │                    │
          └────────────────┴────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Express   │
                    │   Backend   │
                    │   (Bun)     │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │ PostgreSQL  │ │  Workflow   │ │    LLM      │
    │  (Drizzle)  │ │  Providers  │ │  Providers  │
    └─────────────┘ └─────────────┘ └─────────────┘
```

### Runtime Model

- **Primary Runtime**: `AgentService` (Mastra-based agent runtime)
- **Fallback Runtime**: `OrchestratorService` (deterministic orchestration)
- Chat routes attempt agent runtime first; fallback to orchestrator on failure

## 🛠️ Development

### Local Setup

```bash
# Clone and install
git clone <repo>
cd autopilot
bun install

# Environment
cp .env.example .env
# Edit .env with your credentials

# Database (from apps/backend)
bun run db:preflight
bun run db:migrate

# Run all services
bun run dev
```

**Default URLs:**
- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- Health: http://localhost:3000/health

### Build

```bash
# Build all workspaces
bun run build

# Type check
bun run typecheck

# Run tests
bun run test
```

## 🔧 Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs autopilot

# Verify environment variables
docker run --rm ajayduddi/autopilot:latest env | grep -E "(DATABASE_URL|AUTH_COOKIE_SECRET)"
```

### Database Connection Issues

```bash
# Test connectivity
docker exec -it autopilot ping your-db-host

# Run preflight check
bun run db:preflight
```

### Webhook Callbacks Not Received

1. Verify `CALLBACK_BASE_URL` points to public URL
2. Check webhook secret configuration
3. Ensure firewall allows incoming POST to `/api/webhooks/*`

### LLM Provider Errors

- Check provider credentials in Settings → AI Providers
- Verify API key encryption key is set (`PROVIDER_API_KEY_ENCRYPTION_KEY`)
- For Ollama, ensure `OLLAMA_URL` is accessible from container

## 📚 Documentation

- [Deployment Guide](docs/deployment.md) - Production deployment details
- [Architecture](docs/architecture.md) - System design and runtime model
- [API Reference](docs/api-reference.md) - Endpoint documentation
- [Migrations](docs/migrations.md) - Database migration workflow

## 📄 License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with** 🦋 **Bun** · ⚡ **SolidJS** · 🐘 **PostgreSQL**

</div>
