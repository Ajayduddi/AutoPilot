# API Reference

Base URL: `http://localhost:3000`

All API responses follow this envelope:
```json
{ "status": "ok", "data": { ... } }
```
Errors return:
```json
{ "error": "message", "details": [...] }
```

All requests and responses include the header `x-trace-id` for request lifecycle tracking.

---

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Backend liveness check |

---

## Auth

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/api/auth/state` | — | Returns app auth mode: onboarding/login/authenticated |
| POST | `/api/auth/onboarding/register` | `{ email, name?, password }` | Create first owner account (single-user only) |
| POST | `/api/auth/login` | `{ email, password }` | Login with email/password |
| POST | `/api/auth/logout` | — | Revoke current session |
| GET | `/api/auth/me` | — | Get current authenticated user |
| GET | `/api/auth/account` | — | Get account profile/credential capabilities |
| PATCH | `/api/auth/account/profile` | `{ name }` | Update username/profile name |
| PATCH | `/api/auth/account/email` | `{ email, currentPassword }` | Update email (requires current password) |
| PATCH | `/api/auth/account/password` | `{ currentPassword, newPassword }` | Update password (password accounts only) |
| GET | `/api/auth/google/start` | — | Start Google OAuth |
| GET | `/api/auth/google/callback` | query | Google OAuth callback |

Notes:
- Email change requires `currentPassword`.
- Google-only accounts return `hasPassword: false`; password update is unavailable for those users.

---

## Chat

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/chat/threads` | `{ title? }` | Create a new chat thread |
| POST | `/api/chat/threads/:threadId/messages` | `{ role, content }` | Post a message; triggers the orchestration loop |

`role` enum: `user` \| `assistant` \| `system`

---

## Workflows

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/api/workflows` | — | List all enabled workflows from registry |
| POST | `/api/workflows/:key/execute` | `{ ...params }` | Manually trigger a workflow by key |

---

## Approvals

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/api/approvals` | — | Get all pending approvals |
| POST | `/api/approvals` | `{ runId, userId, summary, details? }` | Create approval request (called by n8n) |
| POST | `/api/approvals/:id/resolve` | `{ status }` | Resolve an approval (`approved` \| `rejected`) |

---

## Notifications

| Method | Path | Description |
|---|---|---|
| GET | `/api/notifications` | Fetch unread inbox |
| GET | `/api/notifications/stream` | SSE stream (keep-alive, real-time events) |
| POST | `/api/notifications/:id/read` | Mark a notification as read |

### SSE Event Envelope
```json
{ "type": "notification" | "workflow_update", "data": { ... } }
```

---

## Webhooks (provider callbacks)

| Method | Path | Header Required | Body | Description |
|---|---|---|---|---|
| POST | `/api/webhooks/callback` | `x-webhook-secret` | `{ traceId, workflowKey, provider, status, result?, raw?, error?, meta? }` | Unified callback for all providers |
| POST | `/api/webhooks/n8n` | `x-webhook-secret` (or legacy `x-n8n-secret`) | `{ type, runId, result?, error? }` | Backward-compatible n8n callback |

`type` enum: `completed` \| `error`

`status` enum: `running` \| `completed` \| `failed` \| `waiting_approval`

### Example: Unified Callback
```bash
curl -X POST "http://localhost:3000/api/webhooks/callback" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: whsec_your_generated_key_here" \
  -d '{
    "traceId": "trace_123",
    "workflowKey": "wf_portfolio",
    "provider": "n8n",
    "status": "completed",
    "result": { "summary": "Workflow completed" },
    "raw": { "providerRunId": "abc123" }
  }'
```

### Example: Legacy n8n Callback
```bash
curl -X POST "http://localhost:3000/api/webhooks/n8n" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: whsec_your_generated_key_here" \
  -d '{
    "type": "completed",
    "runId": "run_123",
    "result": { "summary": "Workflow completed" }
  }'
```
