# Agent Runtime Notes (Current Default)

## Summary

`AgentService` is the primary runtime for chat handling.

Fallback behavior:

- If agent runtime fails for a request, backend falls back to `OrchestratorService`.
- This applies to both non-streaming and streaming chat message routes.

## Entry Points

- `POST /api/chat/threads/:threadId/messages`
- `POST /api/chat/threads/:threadId/messages/stream`

Flow in `chat.routes.ts`:

1. Persist user message
2. Attempt agent runtime
3. Fallback to orchestrator on error
4. Persist/stream assistant output blocks

## Runtime Controls

Runtime control source:

- `${AUTOPILOT_HOME}/config.json`
- default if unset: `~/.autopilot/config.json`

Common controls:

- `approvalMode` (`default` or `auto`)
- `forceInteractiveQuestions`
- `uploadDir`
- `AGENT_RUNTIME_MAX_STEPS`
- `MASTRA_AGENT_MODEL`
- `AGENT_MCP_ENABLED`
- `AGENT_MCP_SERVERS_JSON`
- `AGENT_MCP_TIMEOUT_MS`
- `LLM_*` timeout keys
- `AUTO_ROUTER_*` breaker keys
- `CONTEXT_MODE_*`

Reference: `apps/backend/src/config/runtime.config.ts`

## Verification Checklist

1. Non-streaming chat still returns assistant message.
2. Streaming chat emits block/chunk events and `complete`.
3. Workflow-triggering queries still execute/dispatch as expected.
4. Approval cards still render and resolve paths still work.
5. Force a controlled agent failure and confirm orchestrator fallback works.

## Rollback Plan

If agent runtime needs emergency rollback:

- Route chat requests directly to orchestrator paths in `chat.routes.ts`.
- No database migration/rollback is required for this runtime switch.
