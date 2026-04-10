# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Worker (Cloudflare Worker)
```bash
cd worker
npm run dev          # Local dev with wrangler (reads worker/.dev.vars for secrets)
npm run deploy       # Deploy to Cloudflare Workers
npm test             # Run vitest tests
npm run test:watch   # Watch mode
```

### Run a single test file
```bash
cd worker && npx vitest run tests/scoring.test.ts
```

### Static site generator
```bash
cd site
npm run generate     # Reads Supabase, writes HTML to dist/
                     # Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars
```

### Register Telegram webhook after deploy
```bash
curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WORKER_URL}"
```

## Architecture

See `docs/plans/2026-04-10-oraculobot-design.md` for the full system design.
See `docs/setup.md` for first-time deployment instructions.

**Request flow:**
```
Telegram POST → worker/src/index.ts
  → worker/src/router.ts  (checks conversation state, routes to handler)
    → worker/src/handlers/  (registration, menu, prediction, ranking, matches, question)
    → worker/src/handlers/admin/  (result, invite, match)
```

**Multi-step conversation flows** (predicting, entering results, creating matches) store state in the `conversation_state` Supabase table. The `step` field acts as an FSM state; `context` holds intermediate values (match ID, team names, etc.).

**Admin authorization** is done by comparing `telegram_id` against the `ADMIN_TELEGRAM_ID` environment variable — no DB lookup needed, cannot be spoofed.

**Scoring logic** is a pure function in `worker/src/services/scoring.ts`:
- 5 pts: exact score
- 3 pts: correct result (win/draw/win)
- +1 bonus: correct goal difference (only when not exact)
Points are calculated in the worker when admin enters a result and persisted to `predictions.points`.

**Site regeneration** is fire-and-forget: `worker/src/services/github.ts` calls `workflow_dispatch` on `build-site.yml` after every result. If it fails, data in Supabase is correct; re-run from GitHub Actions manually.

## Project structure

```
worker/src/
  index.ts              # Worker entry point
  router.ts             # Telegram update router + conversation state dispatch
  types.ts              # All shared TypeScript interfaces
  telegram.ts           # Telegram Bot API client (sendMessage, sendMenu, editMenu...)
  supabase.ts           # Supabase REST client (SupabaseClient class)
  handlers/
    registration.ts     # Invite code validation + user creation
    menu.ts             # Main inline keyboard menus + callback routing
    prediction.ts       # Prediction flow (show matches, capture score)
    ranking.ts          # Leaderboard display
    matches.ts          # Matches list display
    question.ts         # DeepSeek NLQ flow
    admin/
      result.ts         # Admin: enter match result + calculate points
      invite.ts         # Admin: generate invite code
      match.ts          # Admin: create match (multi-step)
  services/
    scoring.ts          # Pure calculatePoints() function
    deepseek.ts         # DeepSeek chat completions API client
    github.ts           # GitHub Actions workflow_dispatch trigger
site/src/
  generate.ts           # Node.js script: queries Supabase → generates HTML to dist/
supabase/migrations/
  001_initial.sql       # All tables + indexes + RLS
  002_leaderboard_rpc.sql
  003_increment_invite_rpc.sql
.github/workflows/
  build-site.yml        # Triggered by Worker; builds and deploys to GitHub Pages
```

## Local dev setup

Create `worker/.dev.vars` (gitignored) with all secrets listed in `worker/wrangler.toml` comments. Wrangler reads this file automatically in `npm run dev`.
