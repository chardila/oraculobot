# Database Backup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Export critical Supabase tables daily to a private GitHub repo via GitHub Actions.

**Architecture:** A TypeScript script (`WorldCup2026/backup.ts`) fetches rows from `users`, `predictions`, `leagues`, and `invite_codes` using the Supabase REST API with pagination, writes JSON files to a temp dir, and a GitHub Actions workflow commits them to the private `chardila/oraculobot-backup` repo every day at 03:00 UTC.

**Tech Stack:** TypeScript + tsx (no build step), Supabase REST API, GitHub Actions, git CLI in workflow.

---

### Task 1: Create the backup script

**Files:**
- Create: `WorldCup2026/backup.ts`

**Step 1: Write the script**

```typescript
// Run with: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx WorldCup2026/backup.ts
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const TABLES = ['users', 'predictions', 'leagues', 'invite_codes'];
const PAGE_SIZE = 1000;

async function fetchAllRows(table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  let offset = 0;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=*`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          Range: `${offset}-${offset + PAGE_SIZE - 1}`,
          'Range-Unit': 'items',
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch ${table}: ${res.status} ${await res.text()}`);
    }

    const page = (await res.json()) as unknown[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function main() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const outDir = path.join('backup-output', date);
  fs.mkdirSync(outDir, { recursive: true });

  for (const table of TABLES) {
    console.log(`Fetching ${table}...`);
    const rows = await fetchAllRows(table);
    const filePath = path.join(outDir, `${table}.json`);
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
    console.log(`  → ${rows.length} rows written to ${filePath}`);
  }

  console.log('Backup complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: Test locally**

From the repo root, run:
```bash
SUPABASE_URL=<your-url> SUPABASE_SERVICE_KEY=<your-key> npx tsx WorldCup2026/backup.ts
```

Expected output:
```
Fetching users...
  → N rows written to backup-output/2026-06-07/users.json
Fetching predictions...
  → N rows written to backup-output/2026-06-07/predictions.json
Fetching leagues...
  → N rows written to backup-output/2026-06-07/leagues.json
Fetching invite_codes...
  → N rows written to backup-output/2026-06-07/invite_codes.json
Backup complete.
```

Verify `backup-output/2026-06-07/predictions.json` is a valid JSON array with the expected fields (`id`, `user_id`, `match_id`, `home_score`, `away_score`, `points`).

**Step 3: Add backup-output to .gitignore**

Add this line to the repo root `.gitignore` (the output dir must not be committed to the public repo):
```
backup-output/
```

**Step 4: Commit**

```bash
rtk git add WorldCup2026/backup.ts .gitignore
rtk git commit -m "feat: add database backup script"
```

---

### Task 2: Create the GitHub Actions workflow

**Files:**
- Create: `.github/workflows/backup.yml`

**Step 1: Write the workflow**

```yaml
name: Daily Database Backup

on:
  schedule:
    - cron: '0 3 * * *'   # 03:00 UTC daily
  workflow_dispatch:

concurrency:
  group: backup
  cancel-in-progress: true

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Run backup script
        run: npx tsx WorldCup2026/backup.ts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

      - name: Push backups to private repo
        env:
          BACKUP_REPO_PAT: ${{ secrets.BACKUP_REPO_PAT }}
          GIT_AUTHOR_NAME: GitHub Actions Backup
          GIT_AUTHOR_EMAIL: backup@github-actions.local
          GIT_COMMITTER_NAME: GitHub Actions Backup
          GIT_COMMITTER_EMAIL: backup@github-actions.local
        run: |
          git clone https://x-access-token:${BACKUP_REPO_PAT}@github.com/chardila/oraculobot-backup.git /tmp/backup-repo
          cp -r backup-output/. /tmp/backup-repo/
          cd /tmp/backup-repo
          git add .
          git diff --staged --quiet && echo "No changes to commit" && exit 0
          git commit -m "backup: $(date -u +%Y-%m-%d)"
          git push
```

**Step 2: Commit**

```bash
rtk git add .github/workflows/backup.yml
rtk git commit -m "feat: add daily database backup workflow"
```

---

### Task 3: Create GitHub PAT and add secret (manual steps)

This task is manual — cannot be automated.

**Step 1: Create a Personal Access Token**

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Click "Generate new token"
3. Set: Repository access → Only selected repositories → `chardila/oraculobot-backup`
4. Permissions → Repository permissions → Contents: **Read and write**
5. Generate and copy the token

**Step 2: Add secret to the public repo**

1. Go to `github.com/chardila/oraculobot` → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `BACKUP_REPO_PAT`
4. Value: paste the token from Step 1
5. Save

---

### Task 4: Trigger a test run and verify

**Step 1: Trigger manual workflow run**

Go to GitHub → Actions → "Daily Database Backup" → "Run workflow" → Run workflow

**Step 2: Verify the run**

- Wait for the job to complete (green checkmark)
- If it fails, check the logs — most likely cause: `BACKUP_REPO_PAT` not set or wrong permissions

**Step 3: Verify backup files in private repo**

Go to `github.com/chardila/oraculobot-backup` and confirm a folder `YYYY-MM-DD/` exists with 4 JSON files:
- `users.json`
- `predictions.json`
- `leagues.json`
- `invite_codes.json`

---

## Restoration Reference

When you need to restore from a backup:

1. Clone the backup repo: `git clone https://github.com/chardila/oraculobot-backup.git`
2. Find the desired date folder: `ls oraculobot-backup/`
3. Open Supabase Studio → Table Editor for each table and use "Import data" (CSV/JSON), or run SQL inserts manually.

For predictions (most critical), the JSON has this shape:
```json
[
  { "id": 1, "user_id": "uuid", "match_id": 1, "home_score": 2, "away_score": 1, "points": 5 },
  ...
]
```
