# API Reference (Current)

Base URL (local): `http://localhost:3000`

## Response Conventions

Most success responses:

```json
{ "status": "ok", "data": {} }
```

Some endpoints return `status: "accepted"` (async dispatch) or simple error envelopes:

```json
{ "error": "message" }
```

All requests include/propagate `x-trace-id` via trace middleware.

## Authentication and CSRF

- Session auth is cookie-based.
- Mounted auth-required API groups:
  - `/api/chat`
  - `/api/workflows`
  - `/api/workflow-runs`
  - `/api/notifications`
  - `/api/settings`
- CSRF is enforced for authenticated mutation requests (`POST`, `PUT`, `PATCH`, `DELETE`) using `x-csrf-token` that matches `ap_csrf` cookie.

---

## Health

- `GET /health` — liveness
- `GET /health/ready` — readiness checks (runtime config + DB + webhook security + secrets)
- `GET /health/metrics` — Prometheus text metrics

---

## Auth (`/api/auth`)

- `GET /state`
- `POST /onboarding/register`
- `POST /login`
- `POST /logout`
- `GET /me`
- `GET /account`
- `PATCH /account/profile`
- `PATCH /account/email`
- `PATCH /account/password`
- `GET /google/start`
- `GET /google/callback`

---

## Chat (`/api/chat`)

### Telemetry

- `POST /client-telemetry`

### Threads and messages

- `GET /threads`
- `POST /threads`
- `PATCH /threads/:threadId`
- `DELETE /threads/:threadId`
- `DELETE /threads`
- `GET /threads/:threadId/messages`
- `POST /threads/:threadId/messages` (non-streaming)
- `POST /threads/:threadId/messages/stream` (SSE streaming)
- `POST /threads/:threadId/messages/:messageId/questions/:questionId/answer`

### Thread analytics/context

- `GET /threads/:threadId/react-telemetry`
- `GET /threads/:threadId/audit-log`

### Attachments

- `POST /attachments` (multipart form; requires `threadId`, one or more `files`)
- `GET /attachments/:attachmentId`
- `DELETE /attachments/:attachmentId`

Streaming event types emitted by `/messages/stream`:

- `attachments_linked`
- `user_saved`
- `thinking`
- `block`
- `chunk`
- `block_end`
- `complete`
- `error`

---

## Workflows (`/api/workflows`)

- `GET /`
- `GET /:id`
- `POST /`
- `PATCH /:id`
- `DELETE /:id` (`?mode=archive|hard`)
- `POST /:id/trigger` (returns `status: accepted` on dispatch)
- `GET /:id/runs`
- `POST /:id/validate`
- `POST /test-connection`

---

## Workflow Runs (`/api/workflow-runs`)

- `GET /:runId`
- `GET /trace/:traceId`

Optional query:

- `GET /:runId?includeRaw=true`

---

## Approvals (`/api/approvals`)

- `GET /` (auth required)
- `POST /:id/resolve` (auth required)
- `POST /` (auth user or webhook secret)

---

## Notifications (`/api/notifications`)

- `GET /stream` (SSE)
- `GET /`
- `POST /:id/read`
- `DELETE /`
- `GET /push/public-key`
- `POST /push/subscribe`
- `POST /push/unsubscribe`
- `POST /push/test`

SSE event envelope examples:

```json
{ "type": "notification", "data": {} }
```

```json
{ "type": "workflow_update", "data": {} }
```

---

## Webhooks (`/api/webhooks`)

All webhook callbacks are rate-limited and require callback secret.

- `POST /n8n`
- `POST /callback`

Required header:

- `x-webhook-secret`
- legacy accepted on n8n endpoint: `x-n8n-secret`

### `POST /n8n` body (legacy callback)

```json
{
  "type": "completed",
  "runId": "run_123",
  "result": {}
}
```

`type`: `completed | error`

### `POST /callback` body (unified callback)

```json
{
  "traceId": "trace_123",
  "workflowKey": "wf_portfolio",
  "provider": "n8n",
  "status": "completed",
  "result": {},
  "raw": {},
  "error": null
}
```

`status`: `running | completed | failed | waiting_approval`

---

## Settings (`/api/settings`)

Settings routes are auth-protected and restricted to primary settings user.

- `GET /providers`
- `POST /providers`
- `POST /providers/:id/active`
- `PATCH /providers/:id/model`
- `DELETE /providers/:id`
- `POST /fetch-models`
- `GET /providers/model-capabilities`
- `GET /runtime-preferences`
- `PATCH /runtime-preferences`
- `GET /webhook-secrets`
- `POST /webhook-secrets`
- `DELETE /webhook-secrets/:id`
