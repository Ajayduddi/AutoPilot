# AGENTS.md

Canonical operating guide for AI coding agents in this repository.

## 1) Repository Overview

- Monorepo managed with **Bun workspaces**.
- Product: chat-first automation platform with AI orchestration, workflow execution, approvals, and callback/webhook integration.
- Apps:
  - `apps/backend`: Express API + Drizzle ORM + Postgres
  - `apps/frontend`: Solid Start/Vinxi (`ssr: false`)
  - `packages/shared`: shared contracts/types used by backend + frontend

## 2) Architecture and Key Directories

- Backend routes: `apps/backend/src/routes/*`
- Backend services/orchestration: `apps/backend/src/services/*`
- Backend repositories/data access: `apps/backend/src/repositories/*`
- LLM providers: `apps/backend/src/providers/llm/*`
- Workflow providers: `apps/backend/src/providers/workflow/*`
- Runtime config schema/merge: `apps/backend/src/config/runtime.config.ts`
- DB schema + migration tooling: `apps/backend/src/db/*`
- Frontend chat rendering: `apps/frontend/src/components/chat/*`
- Frontend routes/views: `apps/frontend/src/routes/*`
- Shared wire contracts: `packages/shared/src/*`
- Deployment/runbooks: `docs/deployment.md`, `docs/migrations.md`

## 3) Source-of-Truth Files

- Workspace scripts: `/package.json`, `/apps/backend/package.json`, `/apps/frontend/package.json`
- CI gates: `/.github/workflows/ci.yml`
- Runtime/env baseline: `/.env.example`
- Runtime config contract: `/apps/backend/src/config/runtime.config.ts`
- Chat block DTO contract: `/packages/shared/src/chat-block.types.ts`
- Container runtime: `/Dockerfile`

## 4) Exact Commands

Root:

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run test
```

Backend:

```bash
bun --filter=backend run dev
bun --filter=backend run start
bun --filter=backend run build
bun --filter=backend run typecheck
bun --filter=backend run lint
bun --filter=backend run test
```

Backend DB:

```bash
bun --filter=backend run db:generate
bun --filter=backend run db:migrate
bun --filter=backend run db:seed
bun --filter=backend run db:preflight
bun --filter=backend run db:repair
bun --filter=backend run db:repair:analyze
bun --filter=backend run db:repair:apply
bun --filter=backend run db:push
bun --filter=backend run db:push:guarded
```

Frontend:

```bash
bun --filter=frontend run dev
bun --filter=frontend run build
bun --filter=frontend run start
bun --filter=frontend run typecheck
bun --filter=frontend run test
```

## 5) Testing Policy

Required before finalizing a change:

1. Run `typecheck` for all touched workspaces.
2. Run targeted tests for changed behavior.
3. For backend API/auth/security/streaming changes, run backend tests including relevant integration/e2e coverage.

Backend test locations:

- `apps/backend/test/config`
- `apps/backend/test/middleware`
- `apps/backend/test/services`
- `apps/backend/test/e2e`

CI currently enforces:

- quality: typecheck + backend lint + build + test
- security audit: `bun audit`
- migration preflight job with Postgres service
- backend smoke for `/health` and `/health/ready`

## 6) Non-Negotiable Guardrails

1. Do not break main-agent behavior or routing semantics.
2. Do not silently break chat block contracts (`summary`, `detail_toggle`, `markdown`, `email_draft`, `question_mcq`, `source`).
3. Keep backend layering: **routes -> services -> repositories**.
4. Keep security middleware enabled by default (auth, CSRF, rate limit, security headers, webhook verification).
5. Do not weaken production env/config validation in backend bootstrap.
6. Do not use destructive git commands unless explicitly requested.
7. Do not mix unrelated UI redesign into behavior fixes.
8. **Bun runtime is mandatory across this repository**: prefer Bun-native APIs/utilities for filesystem, crypto, path/process/runtime operations.
9. **Do not introduce new `node:*` runtime modules** (`node:fs`, `node:path`, `node:crypto`, etc.) when a Bun-native equivalent exists.
10. If existing code uses Node runtime modules in touched files, migrate those touched paths to Bun-native APIs as part of the same change unless blocked by a third-party library contract.

## 7) Style and Conventions (Inferred from Code)

- Language: TypeScript across backend/frontend/shared.
- Backend: Express middleware composition, service-first business logic, structured logging utility.
- Frontend: SolidJS control flow (`Show`, `For`) + Tailwind utility styling.
- Naming:
  - backend modules: `*.service.ts`, `*.routes.ts`, `*.repo.ts`
  - frontend components: PascalCase file names
- String quote style is mixed in repo. Match local file style when editing.

## 8) Dependency Policy

- Bun is package manager/runtime; `bun.lock` is authoritative.
- Use `workspace:*` for internal package references.
- Prefer deterministic installs (`--frozen-lockfile`) in CI/container flows.
- Add dependencies only to the workspace that needs them.
- Avoid build steps that depend on runtime network fetches unless explicitly required.
- Runtime helpers should prefer Bun-native primitives over Node stdlib imports.

## 9) Database Policy

- Production-safe schema flow:
  1. `db:preflight`
  2. `db:repair:analyze` / `db:repair:apply` if needed
  3. `db:generate`
  4. `db:migrate`
- `db:push` is for local/dev convenience; it is blocked for production by guarded script.

## 10) Docker/Runtime Policy

- Production direction is **single-process backend container**.
- Frontend is built to static assets and served by backend (`FRONTEND_STATIC_DIR`).
- Current container entrypoint is backend direct command in `Dockerfile`.
- `scripts/start-all.sh` is legacy helper; Docker runtime does not depend on it.

## 11) Playbooks for Common Tasks

### A) Add or modify backend endpoint

1. Update request schema in `apps/backend/src/schemas/*` if applicable.
2. Update route in `apps/backend/src/routes/*`.
3. Implement/update service and repository logic.
4. Ensure auth/CSRF/rate-limit/security behavior remains correct.
5. Run backend typecheck + targeted tests.

### B) Modify chat output/rendering

1. Verify contract in `packages/shared/src/chat-block.types.ts`.
2. Update backend block producer if needed.
3. Update frontend renderer in `apps/frontend/src/components/chat/*`.
4. Validate desktop + mobile behavior.
5. Run frontend typecheck + relevant tests.

### C) Change DB schema or migration behavior

1. Run DB policy flow from section 9.
2. Document migration/rollback impact in PR summary.

### D) Modify Docker/deployment

1. Preserve single-process runtime intent.
2. Validate env requirements and static frontend serving behavior.
3. Prefer image reproducibility over fragile size optimizations.

## 12) Change Checklist (Before Final Response)

- [ ] Scope is explicit and bounded.
- [ ] Contracts preserved or additive-only changes documented.
- [ ] Typecheck run for touched workspaces.
- [ ] Relevant tests run (or explicitly stated if skipped).
- [ ] Security implications reviewed.
- [ ] DB safety reviewed for schema/data changes.
- [ ] Final report includes files changed + validations run.

## 13) Communication and Reporting Expectations

- Report what changed, why, and where (paths).
- Report validations actually executed.
- Call out risks and tradeoffs directly.
- If blocked, explain blocker, attempts, and safest next step.
