# Database Backup Design

**Date:** 2026-06-07  
**Status:** Approved

## Problem

Supabase free plan does not include automated backups. User-generated data (predictions, users) cannot be recovered if lost. The repo is public, so backups cannot be committed to it directly.

## Solution

Daily GitHub Actions workflow exports critical tables as JSON and commits them to a private backup repo (`chardila/oraculobot-backup`).

## Architecture

```
GitHub Actions (cron 03:00 UTC daily)
  └─ npx tsx WorldCup2026/backup.ts
       ├─ Supabase REST API (SUPABASE_URL + SUPABASE_SERVICE_KEY)
       ├─ Tables: users, predictions, leagues, invite_codes
       └─ Output: backups/YYYY-MM-DD/{users,predictions,leagues,invite_codes}.json
  └─ git commit + push → chardila/oraculobot-backup (via BACKUP_REPO_PAT)
```

## Tables Backed Up

| Table | Reason |
|-------|--------|
| `users` | User accounts — cannot be recreated |
| `predictions` | Core user data with points — cannot be recreated |
| `leagues` | League groupings |
| `invite_codes` | Registration codes with usage counts |

Excluded (can be rebuilt from scripts or `worldcup.json`): `matches`, `wc_*`, `knockout_brackets`, `conversation_state`, `question_logs`.

## Components

### `WorldCup2026/backup.ts`
- Fetches each table via Supabase REST with pagination (1000 rows/page via `Range` header)
- Writes `backups/YYYY-MM-DD/<table>.json` (array of row objects)
- Overwrites if same-day re-run
- Exits with code 1 on any fetch error so GitHub Actions marks the run failed

### `.github/workflows/backup.yml`
- Trigger: `schedule` (cron `0 3 * * *`) + `workflow_dispatch`
- Steps: checkout → Node setup → `npm ci` → run script → clone private repo → copy files → commit + push

## Secrets

| Secret | Repo | Status |
|--------|------|--------|
| `SUPABASE_URL` | public repo | exists |
| `SUPABASE_SERVICE_KEY` | public repo | exists |
| `BACKUP_REPO_PAT` | public repo | **must be created** — GitHub PAT with `repo` scope on `oraculobot-backup` |

## Restoration Process

1. Clone `chardila/oraculobot-backup`
2. Find folder for the desired date: `backups/YYYY-MM-DD/`
3. Restore data via Supabase Studio (table editor import) or a manual INSERT script reading the JSON files

## Trade-offs

- **Chosen over Supabase CLI dump**: simpler setup, no direct Postgres access needed on free plan
- **Chosen over shell curl in workflow**: TypeScript is more robust for pagination/error handling, consistent with existing scripts, and can be run locally for emergency backups
- **Chosen over artifacts**: public repo artifacts are publicly accessible; private repo is truly private
