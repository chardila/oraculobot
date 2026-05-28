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
                     # Optional: ADMIN_TELEGRAM_ID — excludes admin from leaderboard
```

### Register Telegram webhook after deploy
```bash
curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WORKER_URL}"
```

## Architecture

See `docs/plans/archived/2026-04-10-oraculobot-design.md` for the full system design.
See `docs/setup.md` for first-time deployment instructions.

**Request flow:**
```
Telegram POST → worker/src/index.ts
  → worker/src/router.ts  (checks conversation state, routes to handler)
    → worker/src/handlers/  (registration, menu, prediction, ranking, matches, question)
    → worker/src/handlers/admin/  (result, invite, match)
```

**Multi-step conversation flows** (predicting, entering results, creating matches) store state in the `conversation_state` Supabase table. The `step` field acts as an FSM state; `context` holds intermediate values (match ID, team names, etc.). Users can exit any active flow at any time by sending `/cancel`, which clears the state and shows the main menu.

**User channels**: Regular users interact exclusively through the web UI (`site/jugar.html`). The Telegram bot is admin-only — it is used by the admin to enter match results, generate invite codes, and manage leagues. Regular users do NOT receive Telegram messages; all user-facing communication happens in the web UI.

**Admin authorization** is done by comparing `telegram_id` against the `ADMIN_TELEGRAM_ID` environment variable — no DB lookup needed, cannot be spoofed.

**Scoring logic** is a pure function in `worker/src/services/scoring.ts`:
- 5 pts: exact score
- 3 pts: correct result (win/draw/win)
- +1 bonus: correct goal difference (only when not exact)
Points are calculated in the worker when admin enters a result and persisted to `predictions.points`.

**Site regeneration** is fire-and-forget: `worker/src/services/github.ts` calls `workflow_dispatch` on `build-site.yml` after every result. If it fails, data in Supabase is correct; re-run from GitHub Actions manually.

**Matches page** (`site/src/generate.ts`) groups 104 matches by phase (group stage A-L, then knockout rounds). Each match shows the stadium, city and country via a `VENUE_MAP` lookup. The `ground` column in the `matches` table stores the venue key from `worldcup.json`. The generator also falls back to reading `worldcup.json` directly for venue data. `layout(title, body, activePage?)` accepts an optional third argument to mark the active nav link.

**Question logging** is fire-and-forget: every question submitted via `/api/question` is inserted into `question_logs` (user_id, question, asked_at) without blocking the response. Queryable directly from Supabase for audit purposes.

**Question answering** uses a two-call DeepSeek flow. The first call classifies the question: if it's about polla (ranking, predictions), it answers directly using context. If it's about World Cup history (goals, referees, bookings, standings, awards, etc.), it responds with `SQL: <query>`. The worker executes the query against the `wc_*` tables via the `exec_wc_query` RPC, then a second DeepSeek call converts the rows to a Spanish answer. On SQL error, one retry is attempted with the error message. On empty results, the user is told there's no data. `wc-sql.ts` defines `ALLOWED_TABLES`, `WC_SCHEMA_PROMPT` (schema + examples for DeepSeek), and `validateWcSql` (blocks non-SELECT and disallowed tables; supports CTEs).

**Historical WC data** comes from two sources: openfootball (basic match results 2014–2022, loaded via `download-history.ts`) and the jfjelstul/world-cup-data dataset (enriched data 1930–2022: referees, bookings, substitutions, player appearances, penalty kicks, group standings, awards, goals — loaded via `load-jfjelstul-history.ts`). The jfjelstul script matches records to existing `wc_matches` rows by date + team names and is idempotent.

**wc_goals coverage**: complete for all World Cups. Goals for 1930–1950 came from an earlier load; goals for 1954–2013 were added from jfjelstul; 2014–2022 came from openfootball; 2026 is live. `wc_player_appearances` is only complete from 1970 onwards — for pre-1970 players (Pelé, Eusébio, etc.), use `wc_goals` to infer World Cup participation (count distinct years where scorer ILIKE the name).

**Web UI** (`site/jugar.html`) uses a chat-style interface with two distinct visual modes: the home screen shows a 2×2 grid of app-card tiles (`.menu-card`), while active flows (predict, ranking, question) use pill quick-reply buttons (`.chat-btn`). All pages share a CSS variable design system (`--c-primary`, `--c-bg`, `--c-surface`, etc.) and a white surface panel on an off-white background.

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
    admin/
      result.ts         # Admin: enter match result + calculate points
      invite.ts         # Admin: generate invite code
      league.ts         # Admin: create league (polla)
  services/
    scoring.ts          # Pure calculatePoints() function
    deepseek.ts         # DeepSeek chat completions API client
    github.ts           # GitHub Actions workflow_dispatch trigger
    worldcup-venues.ts  # Static stadium/venue context for DeepSeek prompts
    wc-sql.ts           # ALLOWED_TABLES, WC_SCHEMA_PROMPT, validateWcSql, executeWcQuery for text-to-SQL
    sanitize.ts         # Username sanitization (strips control chars, trims)
  middleware/
    auth.ts             # Web API JWT authentication
    cors.ts             # CORS headers for web API responses
  handlers/web/
    matches.ts          # GET /api/matches — returns all matches from Supabase
    predict.ts          # POST /api/predict — submit prediction for a match
    ranking.ts          # GET /api/ranking — leaderboard for user's league
    question.ts         # POST /api/question — DeepSeek NLQ (logs to question_logs; includes user's predictions in context)
    my-predictions.ts   # GET /api/my-predictions — user's own predictions with results
    register.ts         # POST /api/register — web user registration
    login.ts            # POST /api/login — magic link email login
site/
  jugar.html            # Chat-style web UI (login, predict, ranking, question, my-predictions)
                        # Home screen: 2×2 app-card grid. Active flows: chat pill buttons.
  src/
    generate.ts         # Static site generator: queries Supabase → HTML (ranking, partidos, stats)
    generate.test.ts    # Tests for generator functions
WorldCup2026/
  worldcup.json              # Master fixture data (104 matches, venues, times)
  import.ts                  # CLI script: reads worldcup.json → inserts into Supabase
  download-history.ts        # CLI script: fetches openfootball history → commits JSON to worker/src/data/history/
  load-jfjelstul-history.ts  # CLI script: downloads jfjelstul/world-cup-data (~35MB), enriches wc_* tables (idempotent)
supabase/migrations/
  001_initial.sql       # All tables + indexes + RLS
  002_leaderboard_rpc.sql
  003_increment_invite_rpc.sql
  009_add_match_venue.sql          # Adds ground column to matches
  010_leaderboard_exclude_admin.sql  # leaderboard() returns telegram_id; worker/generator filter admin
  011_question_logs.sql            # Audit log: who asked what and when in the web chat
  012_knockout_bracket.sql         # knockout_bracket table for bracket propagation
  014_wc_history_tables.sql        # wc_matches, wc_goals, wc_teams, wc_stadiums + exec_wc_query RPC
  015_jfjelstul_enrichment.sql     # Enriches wc_matches/wc_goals; adds wc_referees, wc_referee_appearances,
                                   #   wc_bookings, wc_substitutions, wc_player_appearances,
                                   #   wc_penalty_kicks, wc_group_standings, wc_award_winners
  016_normalize_phase_names.sql    # Normalizes phase values (Semifinals→Semi-finals, etc.)
  017_normalize_third_place_phase.sql  # Normalizes third-place match phase label
.github/workflows/
  build-site.yml        # Triggered by Worker; builds and deploys to GitHub Pages
```

## Database migrations — security checklist

**Every `create table` migration MUST include `alter table <name> enable row level security;`** in the same migration file, immediately after the table definition. This has been missed twice in this project (`question_logs`, `knockout_bracket`) and caused Supabase security alerts.

- Tables accessed only by the worker (service role) need RLS enabled but no policies — service role bypasses RLS by design.
- Tables accessed by web users need RLS enabled + explicit policies (see `007_rls_policies.sql` for examples).
- After adding any migration, run `mcp__supabase__get_advisors` with `type: "security"` to verify no new ERRORs.

## Git workflow

### Starting a feature
Always create a feature branch before multi-step work so it can be submitted as a PR:
```bash
git checkout -b feature/my-feature   # or fix/my-fix
```
Use a worktree when working in parallel with the main branch:
```bash
git worktree add .worktrees/my-feature -b feature/my-feature
```

### After a PR is merged
GitHub is configured to **auto-delete the remote branch on merge**. Still run these locally after every merge:
```bash
git checkout main
git pull                          # pull the merged commit
git branch -d feature/my-feature  # delete local branch (-D if squash-merged)
git worktree remove .worktrees/my-feature  # if a worktree was used
```

To quickly verify everything is clean:
```bash
git branch -a          # should show only main (and remotes/origin/main)
git worktree list      # should show only the main worktree
```

### Periodic sync check
If in doubt about whether local is in sync with remote:
```bash
git fetch --prune      # removes stale remote-tracking refs for deleted branches
git branch -a          # review any lingering local branches
git status             # confirm main is up to date with origin/main
```

## Local dev setup

Create `worker/.dev.vars` (gitignored) with all secrets listed in `worker/wrangler.toml` comments. Wrangler reads this file automatically in `npm run dev`.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (90-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk vitest run          # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%)
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->