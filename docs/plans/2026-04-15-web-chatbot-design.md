# Web Chatbot Design

**Date:** 2026-04-15  
**Status:** Approved

## Context

Oraculobot currently runs exclusively as a Telegram bot. Elderly users in the group struggle with installing Telegram. The goal is to add a web-based chatbot to the existing static site (GitHub Pages) so users can participate directly from a browser — no app required.

Admin operations (entering results, generating invite codes, creating matches) stay on Telegram. Only the regular user experience moves to the web.

## Approach

**Hybrid:** keep the existing static pages (ranking, partidos, stats) unchanged, and add an interactive chatbot page (`jugar.html`) backed by new REST endpoints in the Cloudflare Worker.

Architecture:

```
GitHub Pages (static)            Cloudflare Worker              Supabase
─────────────────────            ─────────────────────          ────────────
index.html   (ranking)           POST /   ← Telegram bot        PostgreSQL
partidos.html                    POST /api/register        →    users
stats.html                       GET  /api/matches         ←    matches
jugar.html   (chatbot) ──────►   GET  /api/ranking         ←    leaderboard RPC
                                 POST /api/predict         →    predictions
                                 GET  /api/predictions     ←    predictions
                                 POST /api/question        →    DeepSeek API
                                 OPTIONS /*  (CORS)
                                                                 auth.users (Supabase Auth)
```

## Database Changes

New migration (`004_web_auth.sql`):

```sql
-- Link web users to Supabase Auth
ALTER TABLE users ADD COLUMN auth_user_id uuid REFERENCES auth.users(id);
CREATE UNIQUE INDEX idx_users_auth_user_id ON users(auth_user_id);

-- Rate limiting for DeepSeek questions
ALTER TABLE users ADD COLUMN questions_today int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN questions_reset_at date;
```

Supabase Auth: enable Email provider (magic link) in Supabase dashboard.

New Worker env var: `SUPABASE_JWT_SECRET` (from Supabase dashboard → Settings → API → JWT Secret).

## Authentication Flow

Registration (new user):
1. User goes to `jugar.html`, enters email + invite code
2. Browser POSTs to `POST /api/register`
3. Worker validates invite code (same `invite_codes` table, same usage limit logic)
4. Worker calls Supabase Admin API (`service_role`) → creates `auth.users` entry → sends magic link email
5. Worker creates row in `users` with `auth_user_id`
6. Worker increments `invite_codes.use_count`

Login (returning user):
1. User goes to `jugar.html`
2. If JWT in localStorage and not expired → goes straight to chatbot
3. Otherwise → shows login form (email only, no invite code)

Magic link callback:
1. Supabase emails link pointing to `jugar.html?token=...`
2. JS on page load detects token, exchanges for session JWT via Supabase Auth JS
3. Stores JWT in localStorage

## Worker Endpoints

All endpoints return `Content-Type: application/json` and include CORS headers for the GitHub Pages domain.

JWT verification uses `SUPABASE_JWT_SECRET` (HMAC HS256) — no round-trip to Supabase per request.

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/register` | Public | Validate invite code, create auth user, send magic link |
| `GET /api/matches` | Public | Return scheduled matches as JSON |
| `GET /api/ranking` | Public | Call leaderboard RPC, return JSON |
| `POST /api/predict` | JWT | Validate cutoff (5 min), upsert prediction |
| `GET /api/predictions` | JWT | Return user's own predictions |
| `POST /api/question` | JWT | Rate-limit check, call DeepSeek, return answer |
| `OPTIONS /*` | — | CORS preflight |

### File structure

```
worker/src/
  router.ts                  # add path-based routing (minimal change)
  handlers/
    web/
      register.ts
      matches.ts
      ranking.ts
      predict.ts
      question.ts
  middleware/
    auth.ts                  # verify JWT → return DbUser
    cors.ts                  # CORS headers for GitHub Pages domain
```

## Web Chatbot UI (`jugar.html`)

Single static file — vanilla HTML + CSS + JS (~400 lines). No framework.

**Login screen** (no session):
```
Email:  [________________]
Código: [________________]  ← only on first registration
        [ Entrar ]
"Te enviaremos un enlace mágico a tu correo."
```

**Chatbot screen** (active session):
- Chat bubble layout (bot left, user right)
- Large button groups for choices (no free-text input except "Preguntar")
- Back button always visible → returns to main menu
- State managed in-memory (JS variable) — reload resets to menu
- JWT stored in localStorage

**Conversation flows (web):**
- `🔮 Predecir` → list upcoming matches as buttons → score buttons → confirmation
- `📊 Ranking` → fetch `/api/ranking` → render inline in chat
- `📅 Partidos` → fetch `/api/matches` → render inline in chat
- `❓ Preguntar` → text input appears → POST to `/api/question` → show answer

Styling: reuses CSS variables from existing static site (same font, colors, nav).

`jugar.html` is a manually maintained file deployed to GitHub Pages alongside the generated HTML files (added to `build-site.yml`).

## What Does Not Change

- Entire Telegram bot (router, all handlers, admin flows)
- `index.html`, `partidos.html`, `stats.html` and their generator
- Scoring logic (`calculatePoints`) — runs in Worker when admin enters results via Telegram
- `conversation_state` table — remains Telegram-only; web state is client-side
- Supabase as single source of truth for all data

## Verification

1. **Migration:** confirm new columns appear in `users` table
2. **Register endpoint:** `curl POST /api/register` with valid invite code → magic link email arrives → `users` row created with `auth_user_id`
3. **Full chatbot flow:** login → predict → confirm row in `predictions` → ask question → confirm `questions_today` incremented
4. **Telegram unaffected:** send message to bot → normal response; admin enters result → points calculated, site regenerated
5. **CORS:** `curl OPTIONS /api/matches -H "Origin: https://owner.github.io"` → correct `Access-Control-Allow-Origin`
6. **Rate limiting:** exceed daily question limit → friendly error message; next day → counter reset
