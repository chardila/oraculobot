# OraculoBot

A World Cup prediction bot for friends and family. Users make match predictions through Telegram, and a static leaderboard site auto-updates after every result.

**~$0/month** — runs entirely on free tiers: Cloudflare Workers, Supabase, GitHub Pages, DeepSeek.

## Features

- Invite-only registration via Telegram
- Inline keyboard navigation — no slash commands needed
- Predict match scores before kickoff (closes 5 min before kick)
- Automatic point calculation when admin enters results
- Leaderboard, match results, and stats on a static website
- Natural language questions answered by DeepSeek AI
- Admin controls: enter results, generate invite codes, create matches

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
| Bot | Telegram Bot API (webhook) |
| Backend | Cloudflare Workers (TypeScript) |
| Database | Supabase (Postgres + REST) |
| Static site | GitHub Pages (auto-generated) |
| AI | DeepSeek chat API |

## Architecture

```
Telegram → Cloudflare Worker → Supabase
                     └──────────────────→ GitHub Actions → GitHub Pages
                     └──────────────────→ DeepSeek API (on /question)
```

The Worker receives Telegram webhooks, handles all bot logic, and writes to Supabase. When an admin enters a match result, the Worker triggers a GitHub Actions workflow that reads Supabase and regenerates the static HTML site.

## Prerequisites

- [Cloudflare account](https://cloudflare.com) (free)
- [Supabase project](https://supabase.com) (free)
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- [DeepSeek API key](https://platform.deepseek.com)
- GitHub repository with Pages enabled

## Setup

### 1. Apply database migrations

In Supabase dashboard → SQL Editor, run in order:

1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_leaderboard_rpc.sql`
3. `supabase/migrations/003_increment_invite_rpc.sql`

Then create the bootstrap admin invite code:

```sql
insert into invite_codes (code, created_by, max_uses, use_count)
values ('ADMIN2026', null, 1, 0);
```

### 2. Deploy the Worker

```bash
cd worker
npm install

npx wrangler secret put TELEGRAM_BOT_TOKEN    # from @BotFather
npx wrangler secret put TELEGRAM_BOT_USERNAME # bot username without @
npx wrangler secret put ADMIN_TELEGRAM_ID     # your numeric Telegram ID (get it from @userinfobot)
npx wrangler secret put SUPABASE_URL          # https://<ref>.supabase.co (no trailing slash)
npx wrangler secret put SUPABASE_SERVICE_KEY  # service_role key (not anon) from Supabase Settings → API
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put GITHUB_PAT            # fine-grained token with actions:write
npx wrangler secret put GITHUB_REPO           # owner/repo-name
npx wrangler secret put INVITE_CODE_SECRET    # any random string: openssl rand -hex 32

npx wrangler deploy
```

### 3. Register the Telegram webhook

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>"
# Expected: {"ok":true,"result":true}
```

### 4. Become admin

1. Send `ADMIN2026` to the bot — it registers you as a normal user
2. Get your Telegram ID from the Supabase `users` table or from @userinfobot
3. Run in Supabase SQL Editor:

```sql
update users set is_admin = true where telegram_id = <your-telegram-id>;
```

4. Send any message to the bot — admin options (✅ Result, 🎟 Invite, ➕ Match) appear in the menu.

### 5. Enable GitHub Pages

In repo Settings → Pages → Source: **GitHub Actions**

Add repository secrets (Settings → Secrets → Actions):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

The site rebuilds automatically each time the admin enters a match result.

### 6. Import matches (optional)

The `WorldCup2026/` folder contains match data for the 2026 World Cup. To import it:

```bash
cd WorldCup2026

SUPABASE_URL="https://xxxx.supabase.co" \
SUPABASE_SERVICE_KEY="your-service-role-key" \
npx tsx import.ts
```

## Local development

Create `worker/.dev.vars` (gitignored):

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
ADMIN_TELEGRAM_ID=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
DEEPSEEK_API_KEY=...
GITHUB_PAT=...
GITHUB_REPO=...
INVITE_CODE_SECRET=...
```

```bash
cd worker && npm run dev
```

Use [ngrok](https://ngrok.com) or a Cloudflare tunnel to expose the local port, then point the Telegram webhook at it for testing.

## Commands

```bash
# Worker
cd worker
npm test              # run scoring tests (9 tests)
npm run dev           # local dev server
npm run deploy        # deploy to Cloudflare

# Site generator
cd site
npm run generate      # generate HTML to dist/ (needs SUPABASE_URL + SUPABASE_SERVICE_KEY)
```

## Project structure

```
worker/src/
  index.ts              # Worker entry point (webhook receiver)
  router.ts             # Routes Telegram updates, dispatches conversation state
  types.ts              # Shared TypeScript types
  telegram.ts           # Telegram Bot API client
  supabase.ts           # Supabase REST client
  handlers/
    registration.ts     # Invite code validation + user creation
    menu.ts             # Inline keyboard menus + navigation
    prediction.ts       # Prediction flow
    ranking.ts          # Leaderboard view
    matches.ts          # Match list view
    question.ts         # DeepSeek natural language queries
    admin/
      result.ts         # Enter match result + calculate points
      invite.ts         # Generate invite code
      match.ts          # Create match (multi-step flow)
  services/
    scoring.ts          # Pure calculatePoints() — tested
    deepseek.ts         # DeepSeek API client
    github.ts           # GitHub Actions trigger
site/src/
  generate.ts           # Static site generator (Supabase → HTML)
supabase/migrations/    # SQL migrations (apply in order)
.github/workflows/
  build-site.yml        # Triggered by Worker; deploys to GitHub Pages
WorldCup2026/
  worldcup.json         # Match schedule
  import.ts             # Import script
```

## License

MIT
