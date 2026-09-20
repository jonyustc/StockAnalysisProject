# DSE Stock Research Database

A personal fundamental-research database for Dhaka Stock Exchange companies:
ten years of reported financials entered from primary sources, with every
figure traceable to a document and a page.

Not a stockanalysis.com clone. The things it deliberately does that the paid
sites don't: **NAVPS and NOCFPS** as first-class metrics, DSE's `cash % / stock %`
dividend convention, bonus/rights-adjusted per-share history, and a research
notes layer recording *why* you would buy.

Currently tracking: `SQURPHARMA`, `MARICO`, `BERGERPBL`, `RENATA`, `OLYMPIC`,
`BSRMSTEEL`, `LHBL`.

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router), TypeScript, Tailwind | |
| Database | PostgreSQL — Supabase hosted, local mirror | |
| Access | `node-postgres` + Drizzle | Not `supabase-js` — so `DATABASE_URL` is the only difference between cloud and local |
| Hosting | Vercel Hobby | Free; non-commercial personal use |
| PDFs | OneDrive, referenced by path + page | Supabase Storage's 1 GB free tier would be gone by year two |

## Layout

```
db/
  migrations/     hand-written SQL — the source of truth for the schema
  seed/           reference data, idempotent, safe to re-run
  schema.ts       Drizzle mirror, for typed queries only
  client.ts       pooled connection
scripts/
  migrate.ts      applies migrations in order, tracked in _migrations
app/              Next.js routes
```

## Setup

### 1. Install PostgreSQL locally

Grab the PostgreSQL 17+ Windows installer from
[enterprisedb.com](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads).
It brings `psql`, `pg_dump` and pgAdmin with it, so the backup tooling arrives
in the same step.

Two things to watch:

- **Delete the leftover `C:\Program Files\PostgreSQL\18\data` folder first.**
  There is an orphaned data directory from a previous install with no binaries
  beside it; the installer refuses a non-empty data directory.
- **Install a major version at least as new as Supabase's.** A `pg_dump` older
  than the server it's dumping refuses to run. Check the Supabase version under
  Project Settings > Infrastructure.

Then create the database:

```bash
createdb -U postgres dse_research
```

### 2. Configure

```bash
cp .env.example .env.local
```

Fill in `DATABASE_URL` and `DIRECT_URL`. The comments in `.env.example` explain
why Supabase needs two different connection strings and which port each uses.

### 3. Create the schema

```bash
npm run db:migrate -- --seed
```

This applies `db/migrations/*.sql` in order inside transactions, records each in
a `_migrations` table, then loads sectors, the line-item taxonomy, metric
definitions and the seven companies.

`npm run db:status` shows what is applied and what is pending without changing
anything.

> Applied migrations are checksummed. Editing one after it has run is refused —
> write a new migration instead.

### 4. Run

```bash
npm run dev
```

## Before entering data

**Verify the fiscal year ends in `db/seed/0001_reference_data.sql`.** Only
Marico (31 March) is confirmed. The rest are best-known values marked
`FYE to verify` in the `notes` column. Checking six annual report covers takes
ten minutes now; correcting period boundaries after 700 figures are typed does
not.

Convention: `FY<N>` is the fiscal year **ending** in calendar year N. Marico
FY2026 = 1 Apr 2025 – 31 Mar 2026.

## Two things that quietly corrupt a database like this

**Scale.** Annual reports print figures in units, thousands, millions or crore,
inconsistently and sometimes within one document. Enter the number exactly as
printed and set `scale` to match — `value_base` is derived in Postgres. Never
convert in your head.

**Bonus shares and rights issues.** They change the share count, which makes
historical per-share figures incomparable. Record every one in
`corporate_actions` with its `adjustment_factor`, or the 10-year EPS CAGR is
fiction. The formulae are documented in `db/migrations/0001_init.sql`.

## Backups

Supabase's free plan has no automated backups. The plan:

1. Nightly `pg_dump` via GitHub Actions into a private repo — versioned forever,
   off-platform, and it doubles as the keep-alive that stops a free project
   pausing after a week of inactivity.
2. The dump auto-restores into local Postgres, so the backup is proven to work
   every single day rather than merely existing.
3. Weekly copy to OneDrive.

Worst case, everything is re-typeable from the source documents — which is
exactly what `source_document_id` and `source_page` are for.

## Notes

- `node_modules` lives inside a OneDrive folder, so installs are slow and
  OneDrive will churn syncing thousands of files. Excluding the folder from
  sync, or moving the project off OneDrive, is worth doing.
