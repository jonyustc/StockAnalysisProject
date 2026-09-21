# Database backups

Nightly snapshots of the production (Supabase) database, written by
`.github/workflows/backup.yml` on `main`.

`dump.sql` is **overwritten** each night rather than dated. Every past version
is still here, in this branch's history:

```bash
git log --oneline backups                        # every snapshot
git show backups@{2026-08-01}:dump.sql > old.sql # a specific day
git show <commit>:dump.sql > old.sql
```

Plain SQL, not gzipped, on purpose: git delta-compresses successive text
versions, so a year of nightly snapshots costs a fraction of 365 archives.

`--schema=public` only. A full Supabase dump carries its own extensions
(`supabase_vault`, `pgsodium`) and schemas (`auth`, `storage`, `realtime`),
none of which exist on plain Postgres — so it fails to restore on exactly the
machine you would be restoring to in an emergency.

## Restoring

From the project root on `main`:

```bash
npm run db:restore                                   # verify it restores, then discard
npm run db:restore -- --into=dse_research --yes      # actually replace a local database
```

The workflow refuses to commit a dump that is suspiciously small or missing
expected tables, so a truncated backup fails the job instead of silently
replacing a good one.
