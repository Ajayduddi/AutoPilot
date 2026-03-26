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

## Webhooks (n8n callbacks)

| Method | Path | Header Required | Body | Description |
|---|---|---|---|---|
| POST | `/api/webhooks/n8n` | `x-n8n-secret` | `{ type, runId, result?, error? }` | n8n posts results back |

`type` enum: `completed` \| `error`
