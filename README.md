# OraculoBot

A World Cup prediction bot for friends and family. Users make match predictions through a web interface, and a static leaderboard site auto-updates after every result. The Telegram bot is for admin use only.

**~$0/month** — runs entirely on free tiers: Cloudflare Workers, Supabase, GitHub Pages, DeepSeek.

## Features

- Multiple independent pollas (leagues) — family, friends, colleagues — each with its own ranking
- Invite-only web registration: email + invite code + display name
- Predict match scores before kickoff (closes 5 min before kick)
- Automatic point calculation when admin enters results
- Leaderboard, match results, and stats on a static website (auto-regenerates on every push)
- Natural language questions answered by DeepSeek AI — AI has context of the user's own predictions, the leaderboard, and the full match schedule (question history logged for audit)
- View personal predictions history with scores and points earned
- Reminders modal: on login, if any match kicks off within 24h and hasn't been predicted, a modal prompts the user to predict directly from the alert
- Admin controls via Telegram: enter results, generate invite codes, create matches, create pollas
- **Auto-results:** GitHub Actions polls football-data.org every 30 min, detects finished matches, and sends the admin a Telegram confirmation prompt — no manual score lookup needed
- **Recalculate:** admin can correct a previously entered result and all predictions are re-scored automatically

## Scoring

| Condition | Points |
|-----------|--------|
| Exact score | 5 |
| Correct result (W/D/W) | 3 |
| Correct goal difference (not exact) | +1 |
| Nothing | 0 |

## Stack

| Layer | Technology |
|-------|-----------|
| Bot (admin only) | Telegram Bot API (webhook) |
| Web app | Static HTML + Cloudflare Worker API |
| Backend | Cloudflare Workers (TypeScript) |
| Database | Supabase (Postgres + REST) |
| Static site | GitHub Pages (auto-generated on push) |
| AI | DeepSeek chat API |

## Architecture

```
Participants → Web app (jugar.html) → Cloudflare Worker API → Supabase
Admin        → Telegram Bot         → Cloudflare Worker     → Supabase
                                                └──────────────────→ GitHub Actions → GitHub Pages
                                                └──────────────────→ DeepSeek API (on /question)
```

The Worker receives Telegram webhooks (admin only) and web API requests (participants). When an admin enters a match result, it triggers a GitHub Actions workflow that regenerates the static site.

## Prerequisites

- [Cloudflare account](https://cloudflare.com) (free) — hosts the Worker backend
- [Supabase project](https://supabase.com) (free) — Postgres database + auth
- Telegram bot token from [@BotFather](https://t.me/BotFather) — admin control interface
- [DeepSeek API key](https://platform.deepseek.com) — AI question answering
- [football-data.org API token](https://www.football-data.org/client/register) (free tier) — polls finished match scores for auto-results
- [Zafronix API key](https://zafronix.com) — squad/player data for the 2026 World Cup
- GitHub repository with Pages enabled — hosts the static leaderboard site

## Setup

See [docs/setup.md](docs/setup.md) for the full step-by-step guide. Quick reference below.

### 1. Apply database migrations

In Supabase dashboard → SQL Editor, run all files in `supabase/migrations/` in numeric order (001 through 025).

### 2. Deploy the Worker

```bash
cd worker
npm install

npx wrangler secret put TELEGRAM_BOT_TOKEN       # from @BotFather
npx wrangler secret put TELEGRAM_BOT_USERNAME    # bot username without @
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # random string: openssl rand -hex 32
npx wrangler secret put ADMIN_TELEGRAM_ID        # your numeric Telegram ID (from @userinfobot)
npx wrangler secret put SUPABASE_URL             # https://<ref>.supabase.co (no trailing slash)
npx wrangler secret put SUPABASE_SERVICE_KEY     # service_role key from Supabase Settings → API
npx wrangler secret put SUPABASE_ANON_KEY        # anon public key from Supabase Settings → API
npx wrangler secret put DEEPSEEK_API_KEY         # from platform.deepseek.com
npx wrangler secret put GITHUB_PAT               # fine-grained PAT with actions:write on this repo
npx wrangler secret put GITHUB_REPO              # owner/repo-name (e.g. chardila/oraculobot)
npx wrangler secret put WORKER_ADMIN_SECRET      # random string — protects /api/admin/propose-result
npx wrangler secret put INVITE_CODE_SECRET       # random string: openssl rand -hex 32
npx wrangler secret put WEB_ORIGIN               # https://owner.github.io (CORS origin)
npx wrangler secret put WEB_REDIRECT_URL         # https://owner.github.io/oraculobot/jugar.html (magic link redirect)

npx wrangler deploy
```

### 3. Register the Telegram webhook

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
# Expected: {"ok":true,"result":true}
```

### 4. Create the first polla

Send any message to the bot on Telegram — the admin menu will appear. Use **🏆 Crear polla** to create your first league (e.g. "Polla Principal"), then use **🎟 Invitar** to generate invite codes for participants.

### 5. Create the private backup repo

Before GitHub Actions can push backups, you need to create the target repo and a PAT:

1. On GitHub, create a **private** repo named `oraculobot-backup` (empty)
2. Create a fine-grained PAT: GitHub Settings → Developer settings → Fine-grained tokens → Only `oraculobot-backup` → Contents: Read and Write
3. Save the token as `BACKUP_REPO_PAT` in step 6 below

### 6. Enable GitHub Pages and configure secrets

In repo Settings → Pages → Source: **GitHub Actions**

Add repository secrets (Settings → Secrets → Actions):

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Same as Worker secret |
| `SUPABASE_SERVICE_KEY` | Same as Worker secret |
| `SUPABASE_ANON_KEY` | Same as Worker secret |
| `FOOTBALL_DATA_TOKEN` | Free API token from [football-data.org](https://www.football-data.org/client/register). Used by `check-results.yml` every 30 min to detect finished matches and auto-propose results to admin. |
| `WORKER_URL` | Deployed Worker URL. Used by `check-results.yml` to call `/api/admin/propose-result`. |
| `WORKER_ADMIN_SECRET` | Must match the value set in step 2. |
| `BACKUP_REPO_PAT` | PAT created in step 5. |
| `ZAFRONIX_API_KEY` | API key from Zafronix. Used by `update-squads.yml` to refresh 2026 player rosters daily until the tournament starts. |

The static site rebuilds automatically on every push to `main` and when the admin enters a match result.

### 7. Import fixtures and historical data (optional)

```bash
cd WorldCup2026

# 2026 fixtures (104 matches)
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx import.ts

# Historical WC data 1930-2022 (matches, goals)
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx load-wc-history.ts

# Enriched data from jfjelstul dataset (~35 MB): referees, bookings, player appearances, etc.
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx load-jfjelstul-history.ts

# 2026 squad data (player rosters) from Zafronix
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... ZAFRONIX_API_KEY=... npx tsx load-zafronix-squads.ts
```

## Participant flow

1. Admin generates an invite code for a polla (via Telegram)
2. Participant opens `jugar.html`, enters email + name + invite code → receives magic link
3. Participant clicks the link → lands on the web app authenticated
4. From the web app: predict match scores, view ranking, view personal predictions, ask AI questions

## Local development

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

Use [ngrok](https://ngrok.com) or a Cloudflare tunnel to expose the local port, then point the Telegram webhook at it for testing.

## Database backups

El plan gratuito de Supabase no incluye backups automáticos. Un GitHub Action corre diariamente a las 03:00 UTC y exporta las tablas críticas al repo privado [`chardila/oraculobot-backup`](https://github.com/chardila/oraculobot-backup).

**Tablas incluidas:** `users`, `predictions`, `leagues`, `invite_codes`

**Backup manual:**
```bash
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx WorldCup2026/backup.ts
```

**Restaurar desde un backup:**
1. Clonar el repo privado: `git clone https://github.com/chardila/oraculobot-backup.git`
2. Abrir la carpeta de la fecha deseada (`YYYY-MM-DD/`)
3. Re-insertar los datos en Supabase Studio (Table Editor → Import) o con SQL manual

**Secret requerido en GitHub Actions:** `BACKUP_REPO_PAT` — fine-grained PAT con Contents: read+write sobre `oraculobot-backup`.

## Commands

```bash
# Worker
cd worker
npm test              # run tests (40 tests)
npm run dev           # local dev server
npm run deploy        # deploy to Cloudflare

# Site generator
cd site
npm run generate      # generate HTML to dist/ (needs SUPABASE_URL + SUPABASE_SERVICE_KEY)
```

## Project structure

```
worker/src/
  index.ts              # Worker entry point (webhook + web API router)
  router.ts             # Routes Telegram updates, dispatches conversation state
  types.ts              # Shared TypeScript types
  telegram.ts           # Telegram Bot API client
  supabase.ts           # Supabase REST client
  middleware/
    auth.ts             # JWT authentication for web API
    cors.ts             # CORS headers
  handlers/
    registration.ts     # Telegram invite code validation + user creation
    menu.ts             # Inline keyboard menus + callback routing
    web/
      register.ts       # POST /api/register — email + name + invite code
      login.ts          # POST /api/login — magic link email login
      predict.ts        # POST /api/predict — submit prediction
      ranking.ts        # GET /api/ranking — leaderboard for user's polla
      matches.ts        # GET /api/matches — all matches
      question.ts       # POST /api/question — DeepSeek NLQ (user predictions + leaderboard + schedule in context; logs to question_logs)
      my-predictions.ts # GET /api/my-predictions — user's predictions with results
      reminders.ts      # GET /api/reminders — upcoming unpredicted matches within 24h
    admin/
      result.ts         # Admin: enter match result + calculate points
      invite.ts         # Admin: generate invite code
      league.ts         # Admin: create polla
      recalculate.ts    # Admin: correct a finished result and re-score all predictions
      propose.ts        # Admin: confirm/reject auto-proposed result from football-data.org
  services/
    scoring.ts          # Pure calculatePoints() — tested
    deepseek.ts         # DeepSeek API client
    github.ts           # GitHub Actions trigger
    worldcup-venues.ts  # Stadium/venue context for DeepSeek prompts
    worldcup-history.ts # Historical World Cup data (2014-2022) for DeepSeek prompts
    sanitize.ts         # Username sanitization utility
site/
  jugar.html            # Web app: login, home menu (card grid), predict, ranking,
                        # my predictions, ask AI (chat interface)
                        # Reminders modal: shows on login if matches kick off within 24h
  src/generate.ts       # Static site generator: ranking, partidos, stats pages
supabase/migrations/    # SQL migrations (apply in order, 001–011)
.github/workflows/
  build-site.yml        # Triggered on push to main and by Worker after results
  check-results.yml     # Cron every 30min: polls football-data.org, proposes finished results to admin
  backup.yml            # Cron 03:00 UTC daily: exports critical tables to private backup repo
WorldCup2026/
  worldcup.json         # Master fixture data (104 matches)
  import.ts             # CLI: import worldcup.json → Supabase
  check-results.ts      # CLI: polls football-data.org, matches scores, calls /api/admin/propose-result
  backup.ts             # CLI: exports users/predictions/leagues/invite_codes as JSON
  download-history.ts   # CLI: fetch historical World Cup data
```

## License

MIT
