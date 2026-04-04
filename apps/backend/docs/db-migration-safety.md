# DB Migration Safety Guardrails

This checklist prevents FK/constraint failures during schema pushes.

## 1) Preflight Before Any Risky Migration

Run:

```bash
bun run db:preflight
```

If preflight fails, do **not** run migrations yet.

## 2) Repair First, Then Migrate

Analyze and review action plan:

```bash
bun run db:repair:analyze
```

Apply deterministic repairs:

```bash
bun run db:repair:apply
```

Re-run preflight and ensure it passes.

## 3) FK-Safe Migration Order

1. Add nullable/new columns first.
2. Backfill data in a separate migration/script.
3. Add unique/FK constraints after data is clean.
4. Tighten `NOT NULL` last.

## 4) Guarded Push Flow

Preferred migration command:

```bash
bun run db:push:guarded
```

This blocks push if integrity checks fail.

## 5) Rollback Notes

- **Constraint add failed**: rollback by dropping newly added constraint and repairing data first.
- **FK add failed**: remove orphans, then re-apply FK migration.
- **Backfill failed**: rollback partial writes (transactional where possible), rerun from consistent checkpoint.

Always capture:
- migration id,
- failing SQL/error,
- repair actions performed,
- verification query results.
