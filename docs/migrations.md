# Migration Safety Workflow (Current)

Use this flow for any schema/data change to avoid FK integrity failures.

## Safe Sequence

From `apps/backend`:

1. `bun run db:preflight`
2. If blocking issues are reported:
   - `bun run db:repair:analyze`
   - review the proposed changes
   - `bun run db:repair:apply`
3. `bun run db:generate` (when schema changed)
4. `bun run db:migrate`

`db:push` remains local/dev convenience and is blocked for production mode by guarded push script.

## Why This Matters

Common failure class already observed in this project:

- child rows exist with missing parent FK target (for example workflow runs referencing missing workflow ids)

Preflight/repair catches this before migration/push operations fail mid-way.

## Rollback Notes

- Constraint add (`UNIQUE`, `FK`, `NOT NULL`)
  - rollback: drop constraint, restore previous nullability/index state, rerun preflight.
- FK add
  - rollback: drop FK, run repair to reconcile orphan strategy, then re-apply safely.
- Data backfill/update
  - rollback: restore from backup/snapshot (avoid blind reverse updates).
- Destructive cleanup
  - take snapshot first and log exact affected IDs in the change record.

## Production Release Gate

Do not run production migrations unless all are attached to release artifact:

- preflight output
- repair plan/output (if applicable)
- rollback notes
- backup/snapshot confirmation
