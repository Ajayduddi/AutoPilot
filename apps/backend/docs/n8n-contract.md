# Application <-> n8n Contract

This orchestrator layer enforces a strict standard schema for communicating with the `n8n` workflow engine.

## 1. Initial Dispatch (Outbound)
When a user intent maps to a workflow, the orchestrator POSTs to the configured `n8nWebhookUrl` with:
```json
{
  "_meta": {
    "runId": "trace_1234",
    "workflowKey": "wf_scan_emails",
    "userId": "usr_admin"
  },
  "parameter1": "value1",
  "parameter2": "value2"
}
```
*n8n expects these inbound properties and should immediately respond with `200 OK` without blocking thread execution.*

## 2. Approval Request (Inbound Halt)
If a workflow hits a sensitive spot, n8n natively halts execution via a "Wait" node. It can use a separate standard webhook to POST to `/api/approvals`:
```json
{
  "runId": "trace_1234",
  "userId": "usr_admin", 
  "summary": "Please approve deleting 5 emails",
  "details": { "target": "Drafts folder" }
}
```
*The Orchestrator persists this. The UI prompts the user. Once approved/rejected, the Backend will POST back to the n8n Wait Node Resume URL to continue.*
