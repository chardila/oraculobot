# Setup Guide

## Prerequisites

- [Cloudflare account](https://cloudflare.com) (free) — hosts the Worker backend
- [Supabase project](https://supabase.com) (free) — Postgres database + auth
- Telegram bot token from [@BotFather](https://t.me/BotFather) — admin control interface
- [DeepSeek API key](https://platform.deepseek.com) — AI question answering
- [football-data.org API token](https://www.football-data.org/client/register) (free tier) — polls finished match scores for auto-results
- [Zafronix API key](https://zafronix.com) — squad/player data for the 2026 World Cup
- GitHub repository with Pages enabled — hosts the static leaderboard site

## 1. Create the private backup repo

The daily backup workflow pushes JSON exports to a separate private GitHub repository. You must create it before the workflow runs.

1. On GitHub, create a new **private** repository named `oraculobot-backup` (empty, no README needed)
2. Create a fine-grained Personal Access Token:
   - GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Repository access: **Only select repositories** → `oraculobot-backup`
   - Permissions: **Contents** → Read and Write
3. Copy the token — you will need it as `BACKUP_REPO_PAT` in step 7

## 2. Apply Supabase migrations

In Supabase dashboard → SQL Editor, run in order:

1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_leaderboard_rpc.sql`
3. `supabase/migrations/003_increment_invite_rpc.sql`
4. `supabase/migrations/004_web_auth.sql`
5. `supabase/migrations/005_try_consume_invite_rpc.sql`
6. `supabase/migrations/006_leagues.sql`
7. `supabase/migrations/007_rls_policies.sql`
8. `supabase/migrations/008_invite_code_expiry.sql`
9. `supabase/migrations/009_add_match_venue.sql`
10. `supabase/migrations/010_leaderboard_exclude_admin.sql`
11. `supabase/migrations/011_question_logs.sql`
12. `supabase/migrations/012_knockout_bracket.sql`
13. `supabase/migrations/013_rls_question_logs.sql`
14. `supabase/migrations/014_wc_history_tables.sql`
15. `supabase/migrations/015_jfjelstul_enrichment.sql`
16. `supabase/migrations/016_normalize_phase_names.sql`
17. `supabase/migrations/017_normalize_third_place_phase.sql`
18. `supabase/migrations/018_normalize_scorer_names.sql`
19. `supabase/migrations/019_wc_squads_2026.sql`
20. `supabase/migrations/020_exec_wc_query_allow_cte.sql`
21. `supabase/migrations/021_wc_coaches_2026.sql`
22. `supabase/migrations/022_question_logs_outcome.sql`
23. `supabase/migrations/023_security_fixes.sql`
24. `supabase/migrations/024_revoke_function_public_execute.sql`
25. `supabase/migrations/025_proposed_results.sql`

## 3. Load World Cup fixture and history data

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` env vars set.

```bash
cd WorldCup2026

# Load 2026 fixtures (104 matches) into the matches table
npx tsx import.ts

# Load historical WC matches + goals (1930-2022)
# Idempotent — safe to re-run
npx tsx load-wc-history.ts

# Enrich WC data with jfjelstul dataset (~35MB download):
# referees, bookings, substitutions, player appearances, penalty kicks,
# group standings, award winners, and full goals for 1954-2013
# Idempotent — safe to re-run
npx tsx load-jfjelstul-history.ts

# Load 2026 squad data from Zafronix (player rosters per team)
# Requires ZAFRONIX_API_KEY in addition to Supabase vars
# Idempotent — replaces squad data per team on each run
npx tsx load-zafronix-squads.ts
```

## 4. Create bootstrap admin invite code

```sql
insert into invite_codes (code, created_by, max_uses, use_count)
values ('ADMIN2026', null, 1, 0);
```

## 5. Deploy the Worker

```bash
cd worker
npm install

# Set all secrets
wrangler secret put TELEGRAM_BOT_TOKEN       # from @BotFather
wrangler secret put TELEGRAM_BOT_USERNAME    # bot username without @
wrangler secret put TELEGRAM_WEBHOOK_SECRET  # random string: openssl rand -hex 32
wrangler secret put ADMIN_TELEGRAM_ID        # your numeric Telegram user ID (from @userinfobot)
wrangler secret put SUPABASE_URL             # https://<project>.supabase.co
wrangler secret put SUPABASE_SERVICE_KEY     # service_role key from Supabase Settings → API
wrangler secret put SUPABASE_ANON_KEY        # anon public key from Supabase Settings → API
wrangler secret put DEEPSEEK_API_KEY         # from platform.deepseek.com
wrangler secret put GITHUB_PAT               # fine-grained PAT with actions:write on this repo
wrangler secret put GITHUB_REPO              # owner/repo-name (e.g. chardila/oraculobot)
wrangler secret put WORKER_ADMIN_SECRET      # random string: openssl rand -hex 32 — protects /api/admin/propose-result
wrangler secret put INVITE_CODE_SECRET       # random string: openssl rand -hex 32
wrangler secret put WEB_ORIGIN               # https://owner.github.io (CORS origin)
wrangler secret put WEB_REDIRECT_URL         # https://owner.github.io/repo/jugar.html (magic link redirect)

wrangler deploy
```

## 6. Register the Telegram webhook

```bash
WORKER_URL="https://oraculobot-worker.<account>.workers.dev"
BOT_TOKEN="<your-bot-token>"
WEBHOOK_SECRET="<your-TELEGRAM_WEBHOOK_SECRET>"

curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WORKER_URL}&secret_token=${WEBHOOK_SECRET}"
# Expected: {"ok":true,"result":true}
```

## 7. Enable GitHub Pages and configure secrets

In repo Settings → Pages → Source: **GitHub Actions**

Add repository secrets (Settings → Secrets → Actions):

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Same value as Worker secret |
| `SUPABASE_SERVICE_KEY` | Same value as Worker secret |
| `SUPABASE_ANON_KEY` | Same value as Worker secret |
| `FOOTBALL_DATA_TOKEN` | API token from [football-data.org](https://www.football-data.org/client/register) (free). Used by `check-results.yml` to poll finished match scores every 30 min and auto-propose results to the admin. |
| `WORKER_URL` | Deployed Worker URL (e.g. `https://oraculobot-worker.account.workers.dev`). Used by `check-results.yml` to call `/api/admin/propose-result`. |
| `WORKER_ADMIN_SECRET` | Must match the value set as a Worker secret in step 5. |
| `BACKUP_REPO_PAT` | Fine-grained PAT created in step 1 with Contents: read+write on `oraculobot-backup`. |
| `ZAFRONIX_API_KEY` | API key from Zafronix. Used by `update-squads.yml` to refresh player rosters daily until the tournament starts. |

## 8. Register as admin

1. Send `ADMIN2026` to the bot in Telegram
2. The bot registers you as a normal user
3. In Supabase SQL Editor, promote yourself to admin:

```sql
update users set is_admin = true where telegram_id = <your-telegram-id>;
```

4. Send any message to the bot — the admin menu (✅ Resultado, 🎟 Invitar, ➕ Partido) should appear.

## 9. Local development

Create `worker/.dev.vars` (gitignored):

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
TELEGRAM_WEBHOOK_SECRET=...
ADMIN_TELEGRAM_ID=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
SUPABASE_ANON_KEY=...
DEEPSEEK_API_KEY=...
GITHUB_PAT=...
GITHUB_REPO=...
WORKER_ADMIN_SECRET=...
INVITE_CODE_SECRET=...
WEB_ORIGIN=http://localhost:3000
WEB_REDIRECT_URL=http://localhost:3000/jugar.html
```

```bash
cd worker && npm run dev
```

Use [ngrok](https://ngrok.com/) or Cloudflare tunnel to expose the local server and point the Telegram webhook to it for testing.

## GitHub Actions workflows overview

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `build-site.yml` | Push to `main` + Worker trigger after results | Regenerates and deploys static site to GitHub Pages |
| `check-results.yml` | Every 30 min | Polls football-data.org, auto-proposes finished results to admin via Telegram |
| `backup.yml` | Daily at 03:00 UTC | Exports `users`, `predictions`, `leagues`, `invite_codes` as JSON to `oraculobot-backup` |
| `update-squads.yml` | Daily at 11:00 UTC (manual after tournament starts) | Updates 2026 squad data from Zafronix |
