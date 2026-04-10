# Setup Guide

## Prerequisites

- Cloudflare account (free)
- Supabase project (free)
- Telegram bot (via @BotFather)
- DeepSeek API key
- GitHub repo with Pages enabled

## 1. Apply Supabase migrations

In Supabase dashboard → SQL Editor, run in order:
1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_leaderboard_rpc.sql`
3. `supabase/migrations/003_increment_invite_rpc.sql`

## 2. Create bootstrap admin invite code

```sql
insert into invite_codes (code, created_by, max_uses, use_count)
values ('ADMIN2026', null, 1, 0);
```

## 3. Deploy the Worker

```bash
cd worker
npm install

# Set all secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put ADMIN_TELEGRAM_ID        # your numeric Telegram user ID
wrangler secret put SUPABASE_URL             # https://<project>.supabase.co
wrangler secret put SUPABASE_SERVICE_KEY     # service_role key from Supabase Settings → API
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put GITHUB_PAT               # fine-grained token: actions:write on this repo
wrangler secret put GITHUB_REPO              # owner/repo-name
wrangler secret put INVITE_CODE_SECRET       # any random 32-char string
wrangler secret put TELEGRAM_BOT_USERNAME    # bot username without @

wrangler deploy
```

## 4. Register the Telegram webhook

```bash
WORKER_URL="https://oraculobot-worker.<account>.workers.dev"
BOT_TOKEN="<your-bot-token>"

curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WORKER_URL}"
# Expected: {"ok":true,"result":true}
```

## 5. Register as admin

1. Send `ADMIN2026` to the bot in Telegram
2. The bot registers you as a normal user
3. In Supabase SQL Editor, promote yourself to admin:

```sql
update users set is_admin = true where telegram_id = <your-telegram-id>;
```

4. Send any message to the bot — the admin menu (✅ Resultado, 🎟 Invitar, ➕ Partido) should appear.

## 6. Enable GitHub Pages

In repo Settings → Pages → Source: **GitHub Actions**

Add repository secrets (Settings → Secrets → Actions):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

## 7. Local development

Create `worker/.dev.vars` (gitignored):
```
TELEGRAM_BOT_TOKEN=...
ADMIN_TELEGRAM_ID=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
DEEPSEEK_API_KEY=...
GITHUB_PAT=...
GITHUB_REPO=...
INVITE_CODE_SECRET=...
TELEGRAM_BOT_USERNAME=...
```

```bash
cd worker && npm run dev
```

Use [ngrok](https://ngrok.com/) or Cloudflare tunnel to expose the local server and point the Telegram webhook to it for testing.
