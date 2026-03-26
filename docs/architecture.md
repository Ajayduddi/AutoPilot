# AutoPilot — Architecture & Documentation

## System Overview

AutoPilot is a single-user, chat-first automation platform. Users interact through a conversational interface; the backend orchestrator classifies intent and either responds directly or triggers an n8n workflow via webhook.

---

## Component Map

```mermaid
graph TD
    Browser["Browser / PWA<br/>(SolidStart)"]
    Backend["Backend Orchestrator<br/>(Bun + Express)"]
    DB["PostgreSQL<br/>(Drizzle ORM)"]
    N8N["n8n<br/>(Workflow Engine)"]
    LLM["LLM Provider<br/>(Ollama / Gemini / Groq)"]

    Browser -- "POST /api/chat/threads/:id/messages" --> Backend
    Browser -- "GET /api/notifications/stream (SSE)" --> Backend
    Backend -- "Intent parsing" --> LLM
    Backend -- "CRUD" --> DB
    Backend -- "POST webhook" --> N8N
    N8N -- "POST /api/webhooks/n8n<br/>(results / errors)" --> Backend
    N8N -- "POST /api/approvals<br/>(halt for human input)" --> Backend
```

---

## Core Request Flows

### 1. Normal Chat Message (No Workflow)

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant LLM

    User->>Frontend: Types message
    Frontend->>Backend: POST /api/chat/threads/:id/messages
    Backend->>Backend: Persist user message to DB
    Backend->>LLM: parseIntent(message, workflows[])
    LLM-->>Backend: { type: "chat", reply: "..." }
    Backend->>Backend: Persist assistant reply to DB
    Backend-->>Frontend: { userMessage, assistantReply }
    Frontend->>User: Renders reply bubble
```

### 2. Workflow Trigger

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant DB
    participant N8N

    User->>Frontend: "Scan my emails" 
    Frontend->>Backend: POST /api/chat/threads/:id/messages
    Backend->>DB: parseIntent → workflow match
    Backend->>DB: Create workflow_run (status=running)
    Backend->>N8N: POST webhook (payload + _meta)
    Backend-->>Frontend: { assistantReply (workflow_card block) }
    N8N-->>Backend: POST /api/webhooks/n8n { type:"completed", runId }
    Backend->>DB: Update run status → completed
    Backend->>SSE: Emit WORKFLOW_RUN_UPDATED
    Frontend->>User: Live card updates to "Completed ✓"
```

### 3. Approval Flow

```mermaid
sequenceDiagram
    participant N8N
    participant Backend
    participant Frontend
    participant User

    N8N->>Backend: POST /api/approvals { runId, summary }
    Backend->>DB: Insert approval (status=pending), run→waiting_approval
    Backend->>SSE: Emit WORKFLOW_APPROVAL_REQUESTED
    Frontend->>User: Approval card appears in UI
    User->>Frontend: Clicks "Approve"
    Frontend->>Backend: POST /api/approvals/:id/resolve { status:"approved" }
    Backend->>DB: Update approval → resolved
    Backend->>SSE: Emit WORKFLOW_RUN_UPDATED
    Note over Backend,N8N: n8n resumes via its own Wait Node resume URL
```

---

## Technology Decisions

| Concern | Choice | Reason |
|---|---|---|
| Frontend | SolidStart + SolidJS | Fine-grained reactivity; SSR + client hydration |
| Backend | Bun + Express | Fast runtime; familiar HTTP API layer |
| Database | PostgreSQL + Drizzle | Typed, migration-first ORM |
| Realtime | Server-Sent Events | Simpler than WebSockets; sufficient for 1-user app |
| Workflow Engine | n8n (external) | No-code builder; webhook-native |
| LLM | Pluggable (Ollama default) | Works offline; upgradeable to cloud |
| PWA | Service Worker (cache-first) | Installable + offline-safe |

---

## Directory Structure

```
chat-automation-platform/
├── apps/
│   ├── frontend/           # SolidStart PWA
│   │   ├── public/         # manifest.json, sw.js, icons/
│   │   └── src/
│   │       ├── components/ # UI components (layout, chat, ui)
│   │       ├── routes/     # File-based pages
│   │       └── app.tsx     # Root shell with ErrorBoundary + meta
│   └── backend/            # Bun + Express orchestrator
│       ├── src/
│       │   ├── db/         # Schema, migrations, seed
│       │   ├── middleware/  # trace, error, validate, webhook auth
│       │   ├── providers/llm/ # ILLMProvider, Ollama, Gemini
│       │   ├── repositories/  # Drizzle queries per domain
│       │   ├── routes/        # Express routers
│       │   ├── schemas/       # Zod validation schemas
│       │   └── services/      # Business logic layer
│       └── docs/           # n8n-contract.md, model-policy.md
└── packages/
    └── shared/             # Domain types shared between apps
```
