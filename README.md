# OraculoBot

A World Cup prediction bot for friends and family. Users make match predictions through a web interface, and a static leaderboard site auto-updates after every result. The Telegram bot is for admin use only.

**~$0/month** — runs entirely on free tiers: Cloudflare Workers, Supabase, GitHub Pages, DeepSeek.

## Features

- Multiple independent pollas (leagues) — family, friends, colleagues — each with its own ranking
- Invite-only web registration: email + invite code + display name
- Predict match scores before kickoff (closes 5 min before kick)
- Automatic point calculation when admin enters results
- Leaderboard, match results, and stats on a static website (auto-regenerates on every push)
- Natural language questions answered by DeepSeek AI
- Admin controls via Telegram: enter results, generate invite codes, create matches, create pollas

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
4. `supabase/migrations/004_web_auth.sql`
5. `supabase/migrations/005_try_consume_invite_rpc.sql`
6. `supabase/migrations/006_leagues.sql`
7. `supabase/migrations/007_leaderboard_web_only.sql`

### 2. Deploy the Worker

```bash
cd worker
npm install

npx wrangler secret put TELEGRAM_BOT_TOKEN       # from @BotFather
npx wrangler secret put TELEGRAM_BOT_USERNAME    # bot username without @
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # any random string: openssl rand -hex 32
npx wrangler secret put ADMIN_TELEGRAM_ID        # your numeric Telegram ID (get it from @userinfobot)
npx wrangler secret put SUPABASE_URL             # https://<ref>.supabase.co (no trailing slash)
npx wrangler secret put SUPABASE_SERVICE_KEY     # service_role key from Supabase Settings → API
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put GITHUB_PAT               # fine-grained token with actions:write
npx wrangler secret put GITHUB_REPO              # owner/repo-name
npx wrangler secret put INVITE_CODE_SECRET       # any random string: openssl rand -hex 32
npx wrangler secret put WEB_ORIGIN               # https://owner.github.io
npx wrangler secret put WEB_REDIRECT_URL         # https://owner.github.io/oraculobot/jugar.html

npx wrangler deploy
```

### 3. Register the Telegram webhook

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
# Expected: {"ok":true,"result":true}
```

### 4. Create the first polla

Send any message to the bot on Telegram — the admin menu will appear. Use **🏆 Crear polla** to create your first league (e.g. "Polla Principal"), then use **🎟 Invitar** to generate invite codes for participants.

### 5. Enable GitHub Pages

In repo Settings → Pages → Source: **GitHub Actions**

Add repository secrets (Settings → Secrets → Actions):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

The static site rebuilds automatically on every push to `main` and when the admin enters a match result.

### 6. Import matches (optional)

The `WorldCup2026/` folder contains match data for the 2026 World Cup. To import it:

```bash
cd WorldCup2026

SUPABASE_URL="https://xxxx.supabase.co" \
SUPABASE_SERVICE_KEY="your-service-role-key" \
npx tsx import.ts
```

## Participant flow

1. Admin generates an invite code for a polla (via Telegram)
2. Participant opens `jugar.html`, enters email + name + invite code → receives magic link
3. Participant clicks the link → lands on the web app authenticated
4. From the web app: predict match scores, view ranking, ask AI questions

## Local development

Create `worker/.dev.vars` (gitignored):

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
TELEGRAM_WEBHOOK_SECRET=...
ADMIN_TELEGRAM_ID=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
DEEPSEEK_API_KEY=...
GITHUB_PAT=...
GITHUB_REPO=...
INVITE_CODE_SECRET=...
WEB_ORIGIN=http://localhost:3000
WEB_REDIRECT_URL=http://localhost:3000/jugar.html
```

```bash
cd worker && npm run dev
```

Use [ngrok](https://ngrok.com) or a Cloudflare tunnel to expose the local port, then point the Telegram webhook at it for testing.

## Commands

```bash
# Worker
cd worker
npm test              # run tests (44 tests)
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
    registration.ts     # Admin-only Telegram registration gate
    menu.ts             # Inline keyboard menus + navigation
    prediction.ts       # Prediction flow (Telegram)
    ranking.ts          # Leaderboard view (Telegram)
    matches.ts          # Match list view (Telegram)
    question.ts         # DeepSeek natural language queries (Telegram)
    web/
      register.ts       # Web: register with email + name + invite code
      login.ts          # Web: send magic link to existing user
      predict.ts        # Web: submit prediction
      ranking.ts        # Web: leaderboard filtered by user's polla
      matches.ts        # Web: list matches
      question.ts       # Web: ask AI question
    admin/
      result.ts         # Admin: enter match result + calculate points
      invite.ts         # Admin: generate invite code (with polla selection)
      match.ts          # Admin: create match (multi-step flow)
      league.ts         # Admin: create polla
  services/
    scoring.ts          # Pure calculatePoints() — tested
    deepseek.ts         # DeepSeek API client
    github.ts           # GitHub Actions trigger
site/
  jugar.html            # Interactive web app (auth + predictions + ranking)
  src/generate.ts       # Static site generator (Supabase → HTML, one section per polla)
supabase/migrations/    # SQL migrations (apply in order)
.github/workflows/
  build-site.yml        # Triggered on push to main and by Worker after results
WorldCup2026/
  worldcup.json         # Match schedule
  import.ts             # Import script
```

## License

MIT
