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
4. `supabase/migrations/004_web_auth.sql`
5. `supabase/migrations/005_try_consume_invite_rpc.sql`
6. `supabase/migrations/006_leagues.sql`
7. `supabase/migrations/007_rls_policies.sql`
8. `supabase/migrations/008_invite_code_expiry.sql`
9. `supabase/migrations/009_add_match_venue.sql`
10. `supabase/migrations/010_leaderboard_exclude_admin.sql`
11. `supabase/migrations/011_question_logs.sql`

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
wrangler secret put SUPABASE_ANON_KEY        # anon public key from Supabase Settings → API
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put GITHUB_PAT               # fine-grained token: actions:write on this repo
wrangler secret put GITHUB_REPO              # owner/repo-name
wrangler secret put INVITE_CODE_SECRET       # any random 32-char string
wrangler secret put TELEGRAM_BOT_USERNAME    # bot username without @
wrangler secret put TELEGRAM_WEBHOOK_SECRET  # any random string: openssl rand -hex 32
wrangler secret put WEB_ORIGIN               # https://owner.github.io (CORS origin)
wrangler secret put WEB_REDIRECT_URL         # https://owner.github.io/repo/jugar.html (magic link redirect)

wrangler deploy
```

## 4. Register the Telegram webhook

```bash
WORKER_URL="https://oraculobot-worker.<account>.workers.dev"
BOT_TOKEN="<your-bot-token>"

curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WORKER_URL}&secret_token=${TELEGRAM_WEBHOOK_SECRET}"
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
- `SUPABASE_ANON_KEY`

## 7. Local development

Create `worker/.dev.vars` (gitignored):
```
TELEGRAM_BOT_TOKEN=...
ADMIN_TELEGRAM_ID=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
SUPABASE_ANON_KEY=...
DEEPSEEK_API_KEY=...
GITHUB_PAT=...
GITHUB_REPO=...
INVITE_CODE_SECRET=...
TELEGRAM_BOT_USERNAME=...
TELEGRAM_WEBHOOK_SECRET=...
WEB_ORIGIN=http://localhost:3000
WEB_REDIRECT_URL=http://localhost:3000/jugar.html
```

```bash
cd worker && npm run dev
```

Use [ngrok](https://ngrok.com/) or Cloudflare tunnel to expose the local server and point the Telegram webhook to it for testing.
