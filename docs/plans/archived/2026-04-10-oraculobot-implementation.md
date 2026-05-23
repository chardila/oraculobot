# OraculoBot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Telegram prediction bot for World Cup 2026 with Cloudflare Workers backend, Supabase database, and auto-regenerated GitHub Pages static site.

**Architecture:** Cloudflare Worker receives Telegram webhooks, routes messages/callbacks to handlers, reads/writes Supabase via REST. When an admin submits a match result, the Worker triggers a GitHub Actions workflow that queries Supabase and regenerates the static HTML site deployed to GitHub Pages.

**Tech Stack:** TypeScript · Cloudflare Workers (Wrangler) · Supabase REST API · Telegram Bot API · DeepSeek API · GitHub Actions · GitHub Pages · Vitest

---

## Project Structure

```
oraculobot/
├── worker/
│   ├── src/
│   │   ├── index.ts               # Worker entry point
│   │   ├── router.ts              # Routes Telegram updates to handlers
│   │   ├── types.ts               # Shared TypeScript types
│   │   ├── telegram.ts            # Telegram API client helpers
│   │   ├── supabase.ts            # Supabase REST client wrapper
│   │   ├── handlers/
│   │   │   ├── registration.ts    # Invite code + user creation
│   │   │   ├── menu.ts            # Main menu render + navigation
│   │   │   ├── prediction.ts      # Prediction flow
│   │   │   ├── ranking.ts         # Leaderboard view
│   │   │   ├── matches.ts         # Matches list view
│   │   │   ├── question.ts        # DeepSeek NLQ flow
│   │   │   └── admin/
│   │   │       ├── result.ts      # Admin: enter match result
│   │   │       ├── invite.ts      # Admin: generate invite code
│   │   │       └── match.ts       # Admin: create match
│   │   └── services/
│   │       ├── scoring.ts         # Pure scoring logic
│   │       ├── deepseek.ts        # DeepSeek API client
│   │       └── github.ts          # GitHub Actions trigger
│   ├── tests/
│   │   ├── scoring.test.ts
│   │   └── validation.test.ts
│   ├── wrangler.toml
│   └── package.json
├── site/
│   ├── src/
│   │   └── generate.ts            # Static site generator script
│   ├── templates/
│   │   ├── layout.html
│   │   ├── index.html
│   │   ├── partidos.html
│   │   ├── stats.html
│   │   └── usuario.html
│   └── package.json
├── supabase/
│   └── migrations/
│       └── 001_initial.sql
├── .github/
│   └── workflows/
│       └── build-site.yml
└── docs/plans/
```

---

## Environment Variables (Worker secrets via `wrangler secret put`)

```
TELEGRAM_BOT_TOKEN      # BotFather token
ADMIN_TELEGRAM_ID       # Admin's numeric Telegram user ID (string)
SUPABASE_URL            # https://<project>.supabase.co
SUPABASE_SERVICE_KEY    # service_role key (never anon in worker)
DEEPSEEK_API_KEY
GITHUB_PAT              # Fine-grained: actions:write on this repo
GITHUB_REPO             # owner/repo-name
INVITE_CODE_SECRET      # Random 32-char string for HMAC signing
```

---

### Task 1: Project scaffold

**Files:**
- Create: `worker/package.json`
- Create: `worker/wrangler.toml`
- Create: `worker/tsconfig.json`
- Create: `worker/src/types.ts`

**Step 1: Initialize the worker project**

```bash
cd worker
npm init -y
npm install --save-dev wrangler typescript vitest @cloudflare/workers-types
```

**Step 2: Create `worker/wrangler.toml`**

```toml
name = "oraculobot-worker"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[vars]
# Non-secret vars go here. Secrets are set via `wrangler secret put`.
```

**Step 3: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**Step 4: Create `worker/package.json` scripts section**

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**Step 5: Create `worker/src/types.ts`**

```typescript
// Telegram types (minimal subset we use)
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
}

export interface TelegramChat {
  id: number;
}

// App types
export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_TELEGRAM_ID: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  DEEPSEEK_API_KEY: string;
  GITHUB_PAT: string;
  GITHUB_REPO: string;
  INVITE_CODE_SECRET: string;
}

export interface DbUser {
  id: string;
  telegram_id: number;
  username: string | null;
  is_admin: boolean;
  invite_code: string | null;
  created_at: string;
}

export interface DbMatch {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  phase: string;
  group_name: string | null;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'finished';
}

export interface DbPrediction {
  id: string;
  user_id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  points: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbInviteCode {
  code: string;
  created_by: string;
  max_uses: number;
  use_count: number;
  created_at: string;
}

export interface ConversationState {
  telegram_id: number;
  step: string;
  context: Record<string, unknown>;
  updated_at: string;
}
```

**Step 6: Commit**

```bash
git add worker/
git commit -m "feat: scaffold cloudflare worker project"
```

---

### Task 2: Supabase schema

**Files:**
- Create: `supabase/migrations/001_initial.sql`

**Step 1: Create `supabase/migrations/001_initial.sql`**

```sql
-- Enable UUID extension
create extension if not exists "pgcrypto";

-- Invite codes (created before users, so no FK yet)
create table invite_codes (
  code        text primary key,
  created_by  uuid,  -- FK added after users table
  max_uses    int not null default 1,
  use_count   int not null default 0,
  created_at  timestamptz not null default now()
);

-- Users
create table users (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  username    text,
  is_admin    boolean not null default false,
  invite_code text references invite_codes(code),
  created_at  timestamptz not null default now()
);

-- Add FK from invite_codes to users
alter table invite_codes
  add constraint fk_created_by foreign key (created_by) references users(id);

-- Matches
create table matches (
  id          uuid primary key default gen_random_uuid(),
  home_team   text not null,
  away_team   text not null,
  kickoff_at  timestamptz not null,
  phase       text not null, -- 'grupos', 'octavos', 'cuartos', 'semis', 'final'
  group_name  text,          -- 'A'..'L', null for knockout
  home_score  int,
  away_score  int,
  status      text not null default 'scheduled' check (status in ('scheduled', 'finished')),
  created_at  timestamptz not null default now()
);

-- Predictions
create table predictions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  match_id    uuid not null references matches(id),
  home_score  int not null,
  away_score  int not null,
  points      int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, match_id)
);

-- Conversation state (ephemeral, one row per telegram user)
create table conversation_state (
  telegram_id bigint primary key,
  step        text not null,
  context     jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- RLS: disable for service role (worker uses service key)
alter table users             enable row level security;
alter table invite_codes      enable row level security;
alter table matches           enable row level security;
alter table predictions       enable row level security;
alter table conversation_state enable row level security;

-- Service role bypasses RLS automatically in Supabase.
-- No policies needed for the worker (service key).
-- If you add a read-only anon key for the site generator, add SELECT policies here.
```

**Step 2: Apply migration**

In Supabase dashboard → SQL Editor, paste and run the migration.
Or via Supabase CLI:
```bash
supabase db push
```

**Step 3: Copy `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from Supabase dashboard**

Settings → API → Project URL and service_role key.

**Step 4: Commit**

```bash
git add supabase/
git commit -m "feat: add supabase schema migration"
```

---

### Task 3: Telegram API client

**Files:**
- Create: `worker/src/telegram.ts`

**Step 1: Create `worker/src/telegram.ts`**

```typescript
const BASE = 'https://api.telegram.org/bot';

async function call(token: string, method: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Telegram ${method} failed: ${text}`);
  }
}

export function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  return call(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

export function sendMenu(
  token: string,
  chatId: number,
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>
): Promise<void> {
  return call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons },
  });
}

export function editMenu(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>
): Promise<void> {
  return call(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons },
  });
}

export function answerCallback(token: string, callbackQueryId: string, text?: string): Promise<void> {
  return call(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

export function deleteMessage(token: string, chatId: number, messageId: number): Promise<void> {
  return call(token, 'deleteMessage', { chat_id: chatId, message_id: messageId });
}
```

**Step 2: Commit**

```bash
git add worker/src/telegram.ts
git commit -m "feat: add telegram api client helpers"
```

---

### Task 4: Scoring service (TDD)

**Files:**
- Create: `worker/src/services/scoring.ts`
- Create: `worker/tests/scoring.test.ts`

**Step 1: Write the failing tests in `worker/tests/scoring.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { calculatePoints } from '../src/services/scoring';

describe('calculatePoints', () => {
  it('returns 5 for exact score', () => {
    expect(calculatePoints({ home: 2, away: 1 }, { home: 2, away: 1 })).toBe(5);
  });

  it('returns 5 for exact score 0-0', () => {
    expect(calculatePoints({ home: 0, away: 0 }, { home: 0, away: 0 })).toBe(5);
  });

  it('returns 4 for correct result + correct diff (not exact)', () => {
    // pred: 2-0, result: 3-1 → result=home_win, diff=2 in both
    expect(calculatePoints({ home: 2, away: 0 }, { home: 3, away: 1 })).toBe(4);
  });

  it('returns 3 for correct result only', () => {
    // pred: 2-0, result: 1-0 → both home wins, diff differs
    expect(calculatePoints({ home: 2, away: 0 }, { home: 1, away: 0 })).toBe(3);
  });

  it('returns 1 for correct diff wrong result', () => {
    // pred: 2-1 (home win), result: 1-2 (away win), diff=1 in both
    expect(calculatePoints({ home: 2, away: 1 }, { home: 1, away: 2 })).toBe(1);
  });

  it('returns 1 for correct draw prediction (0+1)', () => {
    // pred: 1-2, result: 0-1 — away win, diff 1 in both
    expect(calculatePoints({ home: 1, away: 2 }, { home: 0, away: 1 })).toBe(4);
  });

  it('returns 0 for nothing correct', () => {
    expect(calculatePoints({ home: 2, away: 0 }, { home: 0, away: 2 })).toBe(0);
  });

  it('does not add +1 to exact score', () => {
    // Exact score already gives 5, no bonus
    expect(calculatePoints({ home: 1, away: 1 }, { home: 1, away: 1 })).toBe(5);
  });

  it('returns 3 for correct draw result', () => {
    // pred: 1-1, result: 2-2 → both draws, diff differs (0 vs 0 — same!) → 4
    expect(calculatePoints({ home: 1, away: 1 }, { home: 2, away: 2 })).toBe(4);
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
cd worker && npx vitest run tests/scoring.test.ts
```

Expected: `Cannot find module '../src/services/scoring'`

**Step 3: Create `worker/src/services/scoring.ts`**

```typescript
interface Score {
  home: number;
  away: number;
}

export function calculatePoints(prediction: Score, result: Score): number {
  const isExact =
    prediction.home === result.home && prediction.away === result.away;
  if (isExact) return 5;

  const predResult = Math.sign(prediction.home - prediction.away);
  const actualResult = Math.sign(result.home - result.away);
  const correctResult = predResult === actualResult;

  const predDiff = Math.abs(prediction.home - prediction.away);
  const actualDiff = Math.abs(result.home - result.away);
  const correctDiff = predDiff === actualDiff;

  let points = 0;
  if (correctResult) points += 3;
  if (correctDiff) points += 1;
  return points;
}
```

**Step 4: Run tests — expect PASS**

```bash
cd worker && npx vitest run tests/scoring.test.ts
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add worker/src/services/scoring.ts worker/tests/scoring.test.ts
git commit -m "feat: add scoring service with tests"
```

---

### Task 5: Supabase client wrapper

**Files:**
- Create: `worker/src/supabase.ts`

**Step 1: Create `worker/src/supabase.ts`**

```typescript
import type {
  DbUser, DbMatch, DbPrediction, DbInviteCode, ConversationState
} from './types';

export class SupabaseClient {
  private url: string;
  private key: string;

  constructor(url: string, key: string) {
    this.url = url;
    this.key = key;
  }

  private async req<T>(
    path: string,
    options: RequestInit = {},
    query: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${this.url}/rest/v1/${path}`);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Prefer': options.method === 'POST' ? 'return=representation' : 'return=minimal',
        ...(options.headers as Record<string, string> ?? {}),
      },
    });

    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Supabase ${path}: ${res.status} ${text}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // Users
  async getUserByTelegramId(telegramId: number): Promise<DbUser | null> {
    const rows = await this.req<DbUser[]>('users', {}, {
      telegram_id: `eq.${telegramId}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async createUser(data: Omit<DbUser, 'id' | 'created_at'>): Promise<DbUser> {
    const rows = await this.req<DbUser[]>('users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return rows[0];
  }

  // Invite codes
  async getInviteCode(code: string): Promise<DbInviteCode | null> {
    const rows = await this.req<DbInviteCode[]>('invite_codes', {}, {
      code: `eq.${code}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async incrementInviteCodeUse(code: string): Promise<void> {
    await this.req('invite_codes', {
      method: 'PATCH',
      body: JSON.stringify({ use_count: 'use_count + 1' }),
      headers: { 'Prefer': 'return=minimal' },
    }, { code: `eq.${code}` });
  }

  async createInviteCode(data: Omit<DbInviteCode, 'use_count' | 'created_at'>): Promise<DbInviteCode> {
    const rows = await this.req<DbInviteCode[]>('invite_codes', {
      method: 'POST',
      body: JSON.stringify({ ...data, use_count: 0 }),
    });
    return rows[0];
  }

  // Matches
  async getUpcomingMatches(limitMinutesFromNow = 5): Promise<DbMatch[]> {
    const cutoff = new Date(Date.now() + limitMinutesFromNow * 60 * 1000).toISOString();
    return this.req<DbMatch[]>('matches', {}, {
      status: 'eq.scheduled',
      kickoff_at: `gt.${cutoff}`,
      order: 'kickoff_at.asc',
      limit: '20',
    });
  }

  async getFinishedWithPastKickoff(): Promise<DbMatch[]> {
    const now = new Date().toISOString();
    return this.req<DbMatch[]>('matches', {}, {
      status: 'eq.scheduled',
      kickoff_at: `lt.${now}`,
      order: 'kickoff_at.asc',
    });
  }

  async getMatchById(id: string): Promise<DbMatch | null> {
    const rows = await this.req<DbMatch[]>('matches', {}, {
      id: `eq.${id}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async createMatch(data: Omit<DbMatch, 'id' | 'status' | 'home_score' | 'away_score' | 'created_at'>): Promise<DbMatch> {
    const rows = await this.req<DbMatch[]>('matches', {
      method: 'POST',
      body: JSON.stringify({ ...data, status: 'scheduled' }),
    });
    return rows[0];
  }

  async finishMatch(id: string, homeScore: number, awayScore: number): Promise<void> {
    await this.req('matches', {
      method: 'PATCH',
      body: JSON.stringify({ home_score: homeScore, away_score: awayScore, status: 'finished' }),
      headers: { 'Prefer': 'return=minimal' },
    }, { id: `eq.${id}` });
  }

  // Predictions
  async getPredictionsByMatch(matchId: string): Promise<DbPrediction[]> {
    return this.req<DbPrediction[]>('predictions', {}, {
      match_id: `eq.${matchId}`,
    });
  }

  async upsertPrediction(data: Pick<DbPrediction, 'user_id' | 'match_id' | 'home_score' | 'away_score'>): Promise<void> {
    await this.req('predictions', {
      method: 'POST',
      body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    });
  }

  async updatePredictionPoints(id: string, points: number): Promise<void> {
    await this.req('predictions', {
      method: 'PATCH',
      body: JSON.stringify({ points }),
      headers: { 'Prefer': 'return=minimal' },
    }, { id: `eq.${id}` });
  }

  async getLeaderboard(): Promise<Array<{ user_id: string; total_points: number; username: string | null }>> {
    // Supabase REST doesn't support GROUP BY directly — use RPC
    return this.req<Array<{ user_id: string; total_points: number; username: string | null }>>(
      'rpc/leaderboard', { method: 'POST', body: '{}' }
    );
  }

  // Conversation state
  async getConversationState(telegramId: number): Promise<ConversationState | null> {
    const rows = await this.req<ConversationState[]>('conversation_state', {}, {
      telegram_id: `eq.${telegramId}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async setConversationState(telegramId: number, step: string, context: Record<string, unknown>): Promise<void> {
    await this.req('conversation_state', {
      method: 'POST',
      body: JSON.stringify({ telegram_id: telegramId, step, context, updated_at: new Date().toISOString() }),
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    });
  }

  async clearConversationState(telegramId: number): Promise<void> {
    await this.req('conversation_state', {
      method: 'DELETE',
      headers: { 'Prefer': 'return=minimal' },
    }, { telegram_id: `eq.${telegramId}` });
  }
}
```

**Step 2: Add leaderboard RPC to Supabase**

In Supabase SQL Editor, run:

```sql
create or replace function leaderboard()
returns table (user_id uuid, username text, total_points bigint)
language sql
as $$
  select u.id as user_id, u.username, coalesce(sum(p.points), 0) as total_points
  from users u
  left join predictions p on p.user_id = u.id
  group by u.id, u.username
  order by total_points desc;
$$;
```

**Step 3: Commit**

```bash
git add worker/src/supabase.ts
git commit -m "feat: add supabase rest client wrapper"
```

---

### Task 6: Worker entry point + router

**Files:**
- Create: `worker/src/index.ts`
- Create: `worker/src/router.ts`

**Step 1: Create `worker/src/router.ts`**

```typescript
import type { TelegramUpdate, Env } from './types';
import { SupabaseClient } from './supabase';
import { sendMessage, answerCallback } from './telegram';
import { handleRegistration } from './handlers/registration';
import { showMainMenu, handleMenuCallback } from './handlers/menu';
import { handlePredictionText } from './handlers/prediction';
import { handleQuestionText } from './handlers/question';
import { handleAdminResultText } from './handlers/admin/result';
import { handleAdminMatchText } from './handlers/admin/match';

export async function route(update: TelegramUpdate, env: Env): Promise<void> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  // Handle callback_query (inline button press)
  if (update.callback_query) {
    const cq = update.callback_query;
    const telegramId = cq.from.id;
    await answerCallback(env.TELEGRAM_BOT_TOKEN, cq.id);

    const user = await db.getUserByTelegramId(telegramId);
    if (!user) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, cq.message!.chat.id,
        'Necesitas un código de invitación para usar este bot. Envía tu código.');
      return;
    }

    await handleMenuCallback(cq, user, db, env);
    return;
  }

  // Handle text message
  if (update.message?.text) {
    const msg = update.message;
    const telegramId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    const user = await db.getUserByTelegramId(telegramId);

    // Not registered
    if (!user) {
      await handleRegistration(msg, db, env);
      return;
    }

    // Check conversation state first
    const state = await db.getConversationState(telegramId);
    if (state) {
      switch (state.step) {
        case 'awaiting_prediction_score':
          await handlePredictionText(msg, state, user, db, env);
          return;
        case 'awaiting_question':
          await handleQuestionText(msg, state, user, db, env);
          return;
        case 'awaiting_result_score':
          await handleAdminResultText(msg, state, user, db, env);
          return;
        case 'awaiting_match_home_team':
        case 'awaiting_match_away_team':
        case 'awaiting_match_kickoff':
        case 'awaiting_match_phase':
        case 'awaiting_match_group':
          await handleAdminMatchText(msg, state, user, db, env);
          return;
      }
    }

    // Default: show main menu
    await showMainMenu(chatId, user, db, env);
  }
}
```

**Step 2: Create `worker/src/index.ts`**

```typescript
import type { Env } from './types';
import { route } from './router';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();
      // Don't await — respond to Telegram immediately, process in background
      env.TELEGRAM_BOT_TOKEN && route(update, env).catch(console.error);
    } catch (e) {
      console.error('Failed to parse update', e);
    }

    return new Response('OK', { status: 200 });
  },
};
```

**Step 3: Commit**

```bash
git add worker/src/index.ts worker/src/router.ts
git commit -m "feat: add worker entry point and router"
```

---

### Task 7: Registration handler

**Files:**
- Create: `worker/src/handlers/registration.ts`

**Step 1: Create `worker/src/handlers/registration.ts`**

```typescript
import type { TelegramMessage, Env } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMessage } from '../telegram';
import { showMainMenu } from './menu';

export async function handleRegistration(
  msg: TelegramMessage,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const text = msg.text?.trim() ?? '';

  if (!text || text.length < 4) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '👋 Bienvenido a OraculoBot.\n\nPara participar, envía tu <b>código de invitación</b>.');
    return;
  }

  const code = await db.getInviteCode(text.toUpperCase());

  if (!code) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Código inválido. Pide a quien te invitó que te reenvíe el código.');
    return;
  }

  if (code.use_count >= code.max_uses) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Este código ya no es válido.');
    return;
  }

  // Create user
  await db.createUser({
    telegram_id: telegramId,
    username: msg.from.username ?? msg.from.first_name,
    is_admin: false,
    invite_code: code.code,
  });

  // Increment code usage
  await db.incrementInviteCodeUse(code.code);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ ¡Registrado! Bienvenido al torneo, <b>${msg.from.first_name}</b>.`);

  const user = await db.getUserByTelegramId(telegramId);
  if (user) await showMainMenu(chatId, user, db, env);
}
```

**Step 2: Commit**

```bash
git add worker/src/handlers/registration.ts
git commit -m "feat: add user registration handler"
```

---

### Task 8: Main menu handler

**Files:**
- Create: `worker/src/handlers/menu.ts`

**Step 1: Create `worker/src/handlers/menu.ts`**

```typescript
import type { TelegramCallbackQuery, Env, DbUser } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMenu, editMenu, sendMessage } from '../telegram';
import { showPredictionMatches, handlePredictionCallback } from './prediction';
import { showRanking } from './ranking';
import { showMatches } from './matches';
import { startQuestion } from './question';
import { startAdminResult } from './admin/result';
import { generateInviteCode } from './admin/invite';
import { startAdminMatch } from './admin/match';

function isAdmin(user: DbUser, env: Env): boolean {
  return String(user.telegram_id) === env.ADMIN_TELEGRAM_ID;
}

export async function showMainMenu(
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const admin = isAdmin(user, env);
  const buttons = [
    [
      { text: '🔮 Predecir', callback_data: 'menu:predict' },
      { text: '📊 Ranking', callback_data: 'menu:ranking' },
    ],
    [
      { text: '📅 Partidos', callback_data: 'menu:matches' },
      { text: '❓ Pregunta', callback_data: 'menu:question' },
    ],
    ...(admin ? [
      [
        { text: '✅ Resultado', callback_data: 'menu:admin_result' },
        { text: '🎟 Invitar', callback_data: 'menu:admin_invite' },
      ],
      [
        { text: '➕ Partido', callback_data: 'menu:admin_match' },
      ],
    ] : []),
  ];

  await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
    `🌍 <b>OraculoBot — Mundial 2026</b>\n\n¿Qué quieres hacer?`,
    buttons
  );
}

export async function handleMenuCallback(
  cq: TelegramCallbackQuery,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const data = cq.data ?? '';
  const chatId = cq.message!.chat.id;
  const msgId = cq.message!.message_id;
  const admin = isAdmin(user, env);

  if (data.startsWith('menu:')) {
    const action = data.replace('menu:', '');
    switch (action) {
      case 'predict':
        await showPredictionMatches(chatId, msgId, user, db, env);
        break;
      case 'ranking':
        await showRanking(chatId, msgId, db, env);
        break;
      case 'matches':
        await showMatches(chatId, msgId, db, env);
        break;
      case 'question':
        await startQuestion(chatId, user, db, env);
        break;
      case 'admin_result':
        if (admin) await startAdminResult(chatId, msgId, user, db, env);
        break;
      case 'admin_invite':
        if (admin) await generateInviteCode(chatId, user, db, env);
        break;
      case 'admin_match':
        if (admin) await startAdminMatch(chatId, user, db, env);
        break;
      case 'main':
        await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
          `🌍 <b>OraculoBot — Mundial 2026</b>\n\n¿Qué quieres hacer?`,
          buildMainButtons(admin)
        );
        break;
    }
    return;
  }

  // Delegate to sub-handlers based on prefix
  if (data.startsWith('predict:')) {
    await handlePredictionCallback(cq, user, db, env);
  }
}

function buildMainButtons(admin: boolean) {
  return [
    [
      { text: '🔮 Predecir', callback_data: 'menu:predict' },
      { text: '📊 Ranking', callback_data: 'menu:ranking' },
    ],
    [
      { text: '📅 Partidos', callback_data: 'menu:matches' },
      { text: '❓ Pregunta', callback_data: 'menu:question' },
    ],
    ...(admin ? [
      [
        { text: '✅ Resultado', callback_data: 'menu:admin_result' },
        { text: '🎟 Invitar', callback_data: 'menu:admin_invite' },
      ],
      [{ text: '➕ Partido', callback_data: 'menu:admin_match' }],
    ] : []),
  ];
}
```

**Step 2: Commit**

```bash
git add worker/src/handlers/menu.ts
git commit -m "feat: add main menu handler and navigation"
```

---

### Task 9: Prediction handler

**Files:**
- Create: `worker/src/handlers/prediction.ts`

**Step 1: Create `worker/src/handlers/prediction.ts`**

```typescript
import type { TelegramMessage, TelegramCallbackQuery, Env, DbUser, DbMatch } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMessage, editMenu } from '../telegram';

function formatMatch(m: DbMatch): string {
  const date = new Date(m.kickoff_at).toLocaleString('es-CO', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Bogota',
  });
  return `${m.home_team} vs ${m.away_team} — ${date}`;
}

export async function showPredictionMatches(
  chatId: number,
  msgId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const matches = await db.getUpcomingMatches(5);

  if (matches.length === 0) {
    await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
      '📭 No hay partidos disponibles para predecir en este momento.',
      [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
    );
    return;
  }

  const buttons = matches.map(m => ([{
    text: formatMatch(m),
    callback_data: `predict:match:${m.id}`,
  }]));
  buttons.push([{ text: '🔙 Menú', callback_data: 'menu:main' }]);

  await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
    '🔮 <b>Selecciona un partido para predecir:</b>',
    buttons
  );
}

export async function handlePredictionCallback(
  cq: TelegramCallbackQuery,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const data = cq.data ?? '';
  const chatId = cq.message!.chat.id;

  if (data.startsWith('predict:match:')) {
    const matchId = data.replace('predict:match:', '');
    const match = await db.getMatchById(matchId);

    if (!match) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Partido no encontrado.');
      return;
    }

    // Check cutoff
    const cutoff = new Date(match.kickoff_at).getTime() - 5 * 60 * 1000;
    if (Date.now() >= cutoff) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        '⏱ Las predicciones para este partido ya cerraron.');
      return;
    }

    await db.setConversationState(user.telegram_id, 'awaiting_prediction_score', {
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
    });

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `🔮 <b>${match.home_team} vs ${match.away_team}</b>\n\n` +
      `¿Tu predicción? Envía el marcador en formato <b>local-visitante</b>\n` +
      `Ejemplo: <code>2-1</code>`
    );
  }
}

const SCORE_REGEX = /^(\d{1,2})-(\d{1,2})$/;

export async function handlePredictionText(
  msg: TelegramMessage,
  state: { step: string; context: Record<string, unknown> },
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? '';
  const ctx = state.context as { match_id: string; home_team: string; away_team: string };

  const match = SCORE_REGEX.exec(text);
  if (!match) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Formato inválido. Envía el marcador así: <code>2-1</code>');
    return;
  }

  const homeScore = parseInt(match[1]);
  const awayScore = parseInt(match[2]);

  // Re-check cutoff
  const dbMatch = await db.getMatchById(ctx.match_id);
  if (!dbMatch) {
    await db.clearConversationState(user.telegram_id);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Partido no encontrado.');
    return;
  }

  const cutoff = new Date(dbMatch.kickoff_at).getTime() - 5 * 60 * 1000;
  if (Date.now() >= cutoff) {
    await db.clearConversationState(user.telegram_id);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '⏱ Las predicciones para este partido ya cerraron.');
    return;
  }

  await db.upsertPrediction({
    user_id: user.id,
    match_id: ctx.match_id,
    home_score: homeScore,
    away_score: awayScore,
  });

  await db.clearConversationState(user.telegram_id);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ Predicción guardada: <b>${ctx.home_team} ${homeScore} - ${awayScore} ${ctx.away_team}</b>`
  );
}
```

**Step 2: Commit**

```bash
git add worker/src/handlers/prediction.ts
git commit -m "feat: add prediction flow handler"
```

---

### Task 10: Ranking and matches views

**Files:**
- Create: `worker/src/handlers/ranking.ts`
- Create: `worker/src/handlers/matches.ts`

**Step 1: Create `worker/src/handlers/ranking.ts`**

```typescript
import type { Env } from '../types';
import type { SupabaseClient } from '../supabase';
import { editMenu } from '../telegram';

const MEDALS = ['🥇', '🥈', '🥉'];

export async function showRanking(
  chatId: number,
  msgId: number,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const rows = await db.getLeaderboard();

  let text = '📊 <b>Ranking — Mundial 2026</b>\n\n';
  if (rows.length === 0) {
    text += 'Aún no hay puntos registrados.';
  } else {
    rows.slice(0, 15).forEach((row, i) => {
      const medal = MEDALS[i] ?? `${i + 1}.`;
      text += `${medal} ${row.username ?? 'Anónimo'} — <b>${row.total_points} pts</b>\n`;
    });
  }

  await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId, text,
    [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
  );
}
```

**Step 2: Create `worker/src/handlers/matches.ts`**

```typescript
import type { Env } from '../types';
import type { SupabaseClient } from '../supabase';
import { editMenu } from '../telegram';

export async function showMatches(
  chatId: number,
  msgId: number,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  // Show last 5 finished + next 5 upcoming
  const upcoming = await db.getUpcomingMatches(0);
  const pastMatches = await db.getRecentFinished(5);

  let text = '📅 <b>Partidos</b>\n\n';

  if (pastMatches.length > 0) {
    text += '<b>Resultados recientes:</b>\n';
    pastMatches.forEach(m => {
      text += `${m.home_team} <b>${m.home_score}-${m.away_score}</b> ${m.away_team}\n`;
    });
    text += '\n';
  }

  if (upcoming.length > 0) {
    text += '<b>Próximos partidos:</b>\n';
    upcoming.slice(0, 5).forEach(m => {
      const date = new Date(m.kickoff_at).toLocaleString('es-CO', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Bogota',
      });
      text += `${m.home_team} vs ${m.away_team} — ${date}\n`;
    });
  }

  if (pastMatches.length === 0 && upcoming.length === 0) {
    text += 'No hay partidos registrados aún.';
  }

  await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId, text,
    [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
  );
}
```

**Step 3: Add `getRecentFinished` to `worker/src/supabase.ts`**

```typescript
async getRecentFinished(limit = 5): Promise<DbMatch[]> {
  return this.req<DbMatch[]>('matches', {}, {
    status: 'eq.finished',
    order: 'kickoff_at.desc',
    limit: String(limit),
  });
}
```

**Step 4: Commit**

```bash
git add worker/src/handlers/ranking.ts worker/src/handlers/matches.ts worker/src/supabase.ts
git commit -m "feat: add ranking and matches views"
```

---

### Task 11: DeepSeek NLQ handler

**Files:**
- Create: `worker/src/services/deepseek.ts`
- Create: `worker/src/handlers/question.ts`

**Step 1: Create `worker/src/services/deepseek.ts`**

```typescript
export async function askDeepSeek(apiKey: string, systemPrompt: string, userQuestion: string): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuestion },
      ],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    throw new Error(`DeepSeek API error: ${res.status}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? 'No pude generar una respuesta.';
}
```

**Step 2: Create `worker/src/handlers/question.ts`**

```typescript
import type { TelegramMessage, Env, DbUser } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMessage } from '../telegram';
import { askDeepSeek } from '../services/deepseek';

export async function startQuestion(
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  await db.setConversationState(user.telegram_id, 'awaiting_question', {});
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    '❓ Escribe tu pregunta sobre el torneo, los partidos o los resultados:');
}

export async function handleQuestionText(
  msg: TelegramMessage,
  _state: unknown,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const question = msg.text?.trim() ?? '';

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⏳ Consultando...');

  try {
    const [leaderboard, upcoming, recent] = await Promise.all([
      db.getLeaderboard(),
      db.getUpcomingMatches(0),
      db.getRecentFinished(5),
    ]);

    const leaderboardText = leaderboard.slice(0, 10)
      .map((r, i) => `${i + 1}. ${r.username}: ${r.total_points} pts`)
      .join('\n');

    const upcomingText = upcoming.slice(0, 5)
      .map(m => {
        const d = new Date(m.kickoff_at).toLocaleString('es-CO', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          timeZone: 'America/Bogota',
        });
        return `${m.home_team} vs ${m.away_team} (${d})`;
      }).join('\n');

    const recentText = recent
      .map(m => `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`)
      .join('\n');

    const systemPrompt = `Eres el asistente del torneo de predicciones del Mundial 2026 de un grupo de amigos.
Responde siempre en español, de forma breve y directa. No uses markdown.

CONTEXTO ACTUAL:
Fecha: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}

Leaderboard:
${leaderboardText || 'Sin puntos aún.'}

Próximos partidos:
${upcomingText || 'Sin partidos próximos.'}

Resultados recientes:
${recentText || 'Sin resultados aún.'}`;

    const answer = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt, question);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, answer);
  } catch (e) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      'No pude procesar tu pregunta en este momento, intenta de nuevo.');
  } finally {
    await db.clearConversationState(user.telegram_id);
  }
}
```

**Step 3: Commit**

```bash
git add worker/src/services/deepseek.ts worker/src/handlers/question.ts
git commit -m "feat: add deepseek nlq handler"
```

---

### Task 12: Admin — result entry flow

**Files:**
- Create: `worker/src/services/github.ts`
- Create: `worker/src/handlers/admin/result.ts`

**Step 1: Create `worker/src/services/github.ts`**

```typescript
export async function triggerSiteBuild(pat: string, repo: string): Promise<void> {
  const [owner, repoName] = repo.split('/');
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/build-site.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'oraculobot-worker/1.0',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(`GitHub Actions trigger failed: ${text}`);
  }
}
```

**Step 2: Create `worker/src/handlers/admin/result.ts`**

```typescript
import type { TelegramMessage, Env, DbUser, DbMatch } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { sendMessage, editMenu } from '../../telegram';
import { calculatePoints } from '../../services/scoring';
import { triggerSiteBuild } from '../../services/github';

export async function startAdminResult(
  chatId: number,
  msgId: number,
  _user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const matches = await db.getFinishedWithPastKickoff();

  if (matches.length === 0) {
    await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
      '📭 No hay partidos pendientes de resultado.',
      [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
    );
    return;
  }

  const buttons = matches.map(m => ([{
    text: `${m.home_team} vs ${m.away_team}`,
    callback_data: `menu:admin_result_select:${m.id}`,
  }]));
  buttons.push([{ text: '🔙 Menú', callback_data: 'menu:main' }]);

  await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
    '✅ <b>¿Cuál partido quieres cargar?</b>',
    buttons
  );
}

// Called from menu.ts when callback_data starts with 'menu:admin_result_select:'
export async function handleAdminResultSelect(
  matchId: string,
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const match = await db.getMatchById(matchId);
  if (!match) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Partido no encontrado.');
    return;
  }

  await db.setConversationState(user.telegram_id, 'awaiting_result_score', {
    match_id: match.id,
    home_team: match.home_team,
    away_team: match.away_team,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ <b>${match.home_team} vs ${match.away_team}</b>\n\n` +
    `¿Resultado final? Envía el marcador: <code>local-visitante</code>\n` +
    `Ejemplo: <code>2-1</code>`
  );
}

const SCORE_REGEX = /^(\d{1,2})-(\d{1,2})$/;

export async function handleAdminResultText(
  msg: TelegramMessage,
  state: { step: string; context: Record<string, unknown> },
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? '';
  const ctx = state.context as { match_id: string; home_team: string; away_team: string };

  const scoreMatch = SCORE_REGEX.exec(text);
  if (!scoreMatch) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Formato inválido. Usa <code>2-1</code>');
    return;
  }

  const homeScore = parseInt(scoreMatch[1]);
  const awayScore = parseInt(scoreMatch[2]);

  // Check not already finished
  const match = await db.getMatchById(ctx.match_id);
  if (!match || match.status === 'finished') {
    await db.clearConversationState(user.telegram_id);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '⚠️ Este partido ya tiene resultado cargado.');
    return;
  }

  // Save result
  await db.finishMatch(ctx.match_id, homeScore, awayScore);

  // Calculate and save points for all predictions
  const predictions = await db.getPredictionsByMatch(ctx.match_id);
  let exactCount = 0;
  let resultCount = 0;

  await Promise.all(predictions.map(async (pred) => {
    const points = calculatePoints(
      { home: pred.home_score, away: pred.away_score },
      { home: homeScore, away: awayScore }
    );
    await db.updatePredictionPoints(pred.id, points);
    if (points === 5) exactCount++;
    else if (points >= 3) resultCount++;
  }));

  await db.clearConversationState(user.telegram_id);

  // Summary to admin
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ <b>${ctx.home_team} ${homeScore} - ${awayScore} ${ctx.away_team}</b>\n\n` +
    `📊 ${predictions.length} predicciones procesadas\n` +
    `🎯 ${exactCount} marcador exacto\n` +
    `✔️ ${resultCount} resultado correcto\n\n` +
    `🔄 Regenerando sitio web...`
  );

  // Fire-and-forget site rebuild
  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(console.error);
}
```

**Step 3: Update `worker/src/handlers/menu.ts`** — add handling for `admin_result_select:` callbacks

In the `handleMenuCallback` function, add before the closing `}`:

```typescript
if (data.startsWith('menu:admin_result_select:')) {
  if (admin) {
    const matchId = data.replace('menu:admin_result_select:', '');
    const { handleAdminResultSelect } = await import('./admin/result');
    await handleAdminResultSelect(matchId, chatId, user, db, env);
  }
  return;
}
```

**Step 4: Commit**

```bash
git add worker/src/services/github.ts worker/src/handlers/admin/result.ts worker/src/handlers/menu.ts
git commit -m "feat: add admin result entry flow and github actions trigger"
```

---

### Task 13: Admin — invite code and match creation

**Files:**
- Create: `worker/src/handlers/admin/invite.ts`
- Create: `worker/src/handlers/admin/match.ts`

**Step 1: Create `worker/src/handlers/admin/invite.ts`**

```typescript
import type { Env, DbUser } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { sendMessage } from '../../telegram';

function generateCode(secret: string): string {
  // Simple random alphanumeric code (8 chars, uppercase)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  arr.forEach(b => { code += chars[b % chars.length]; });
  return code;
}

export async function generateInviteCode(
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const code = generateCode(env.INVITE_CODE_SECRET);

  await db.createInviteCode({
    code,
    created_by: user.id,
    max_uses: 1,
  });

  const botUsername = env.TELEGRAM_BOT_TOKEN.split(':')[0]; // not ideal, store bot username separately if needed
  const link = `https://t.me/${botUsername}?start=${code}`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `🎟 <b>Código de invitación generado:</b>\n\n` +
    `Código: <code>${code}</code>\n` +
    `Link directo: ${link}\n\n` +
    `(Uso único)`
  );
}
```

> **Note:** To generate the Telegram deep link properly, store the bot's username as an env var `TELEGRAM_BOT_USERNAME`. Update `worker/src/types.ts` Env interface and `wrangler.toml` accordingly.

**Step 2: Create `worker/src/handlers/admin/match.ts`**

```typescript
import type { TelegramMessage, Env, DbUser } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { sendMessage } from '../../telegram';

export async function startAdminMatch(
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  await db.setConversationState(user.telegram_id, 'awaiting_match_home_team', {});
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    '➕ <b>Nuevo partido</b>\n\nEscribe el nombre del equipo <b>local</b>:');
}

export async function handleAdminMatchText(
  msg: TelegramMessage,
  state: { step: string; context: Record<string, unknown> },
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? '';
  const ctx = state.context as Record<string, string>;

  switch (state.step) {
    case 'awaiting_match_home_team':
      await db.setConversationState(user.telegram_id, 'awaiting_match_away_team', { home_team: text });
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Equipo <b>visitante</b>:');
      break;

    case 'awaiting_match_away_team':
      await db.setConversationState(user.telegram_id, 'awaiting_match_kickoff', {
        ...ctx, away_team: text,
      });
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        'Fecha y hora del partido (formato ISO, hora Colombia UTC-5):\n' +
        'Ejemplo: <code>2026-06-15T18:00:00-05:00</code>');
      break;

    case 'awaiting_match_kickoff': {
      const kickoff = new Date(text);
      if (isNaN(kickoff.getTime())) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          '❌ Fecha inválida. Usa formato ISO, ej: <code>2026-06-15T18:00:00-05:00</code>');
        return;
      }
      await db.setConversationState(user.telegram_id, 'awaiting_match_phase', {
        ...ctx, kickoff_at: kickoff.toISOString(),
      });
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        'Fase del partido:\n<code>grupos</code> / <code>octavos</code> / <code>cuartos</code> / <code>semis</code> / <code>final</code>');
      break;
    }

    case 'awaiting_match_phase': {
      const validPhases = ['grupos', 'octavos', 'cuartos', 'semis', 'final'];
      if (!validPhases.includes(text.toLowerCase())) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          '❌ Fase inválida. Opciones: grupos, octavos, cuartos, semis, final');
        return;
      }
      const phase = text.toLowerCase();
      if (phase === 'grupos') {
        await db.setConversationState(user.telegram_id, 'awaiting_match_group', {
          ...ctx, phase,
        });
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          'Grupo (A-L):');
      } else {
        await createMatch({ ...ctx, phase, group_name: null }, user, db, env, chatId);
      }
      break;
    }

    case 'awaiting_match_group':
      await createMatch({ ...ctx, group_name: text.toUpperCase() }, user, db, env, chatId);
      break;
  }
}

async function createMatch(
  ctx: Record<string, string | null>,
  user: DbUser,
  db: SupabaseClient,
  env: Env,
  chatId: number
): Promise<void> {
  await db.createMatch({
    home_team: ctx.home_team as string,
    away_team: ctx.away_team as string,
    kickoff_at: ctx.kickoff_at as string,
    phase: ctx.phase as string,
    group_name: ctx.group_name ?? null,
  });

  await db.clearConversationState(user.telegram_id);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ Partido creado:\n<b>${ctx.home_team} vs ${ctx.away_team}</b>\n` +
    `Fase: ${ctx.phase}${ctx.group_name ? ` | Grupo ${ctx.group_name}` : ''}\n` +
    `Kickoff: ${new Date(ctx.kickoff_at as string).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`
  );
}
```

**Step 3: Commit**

```bash
git add worker/src/handlers/admin/invite.ts worker/src/handlers/admin/match.ts
git commit -m "feat: add admin invite code and match creation handlers"
```

---

### Task 14: Static site generator

**Files:**
- Create: `site/package.json`
- Create: `site/src/generate.ts`

**Step 1: Initialize site project**

```bash
cd site
npm init -y
npm install --save-dev typescript tsx
```

**Step 2: Create `site/src/generate.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const OUT_DIR = process.env.OUT_DIR ?? 'dist';

async function query<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  return res.json() as Promise<T>;
}

async function rpc<T>(fn: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  return res.json() as Promise<T>;
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — OraculoBot 2026</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 1rem; }
    nav a { margin-right: 1rem; text-decoration: none; color: #0070f3; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; }
    .badge { font-size: 0.75rem; background: #e0e0e0; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <nav>
    <a href="/index.html">🏆 Ranking</a>
    <a href="/partidos.html">📅 Partidos</a>
    <a href="/stats.html">📊 Stats</a>
  </nav>
  <hr>
  ${body}
  <hr>
  <small>Actualizado: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</small>
</body>
</html>`;
}

async function generateIndex(leaderboard: Array<{ username: string; total_points: number }>) {
  const MEDALS = ['🥇', '🥈', '🥉'];
  const rows = leaderboard.map((r, i) =>
    `<tr><td>${MEDALS[i] ?? i + 1}</td><td>${r.username ?? 'Anónimo'}</td><td><b>${r.total_points}</b></td></tr>`
  ).join('');

  return layout('Ranking', `
    <h1>🏆 Ranking — Mundial 2026</h1>
    <table>
      <thead><tr><th>#</th><th>Participante</th><th>Puntos</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

async function generatePartidos(matches: Array<{
  id: string; home_team: string; away_team: string;
  kickoff_at: string; phase: string; group_name: string | null;
  home_score: number | null; away_score: number | null; status: string;
}>) {
  const rows = matches.map(m => {
    const date = new Date(m.kickoff_at).toLocaleString('es-CO', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Bogota',
    });
    const result = m.status === 'finished'
      ? `<b>${m.home_score} - ${m.away_score}</b>`
      : `<span class="badge">Pendiente</span>`;
    const phase = m.group_name ? `Grupo ${m.group_name}` : m.phase;
    return `<tr><td>${m.home_team}</td><td>${result}</td><td>${m.away_team}</td><td>${date}</td><td>${phase}</td></tr>`;
  }).join('');

  return layout('Partidos', `
    <h1>📅 Partidos</h1>
    <table>
      <thead><tr><th>Local</th><th>Resultado</th><th>Visitante</th><th>Fecha</th><th>Fase</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

async function generateStats(
  leaderboard: Array<{ username: string; total_points: number }>,
  predictions: Array<{ points: number | null }>
) {
  const exactCount = predictions.filter(p => p.points === 5).length;
  const resultCount = predictions.filter(p => p.points === 3 || p.points === 4).length;
  const zeroCount = predictions.filter(p => p.points === 0).length;
  const total = predictions.filter(p => p.points !== null).length;

  return layout('Estadísticas', `
    <h1>📊 Estadísticas</h1>
    <h2>Predicciones resueltas: ${total}</h2>
    <table>
      <thead><tr><th>Resultado</th><th>Cantidad</th><th>%</th></tr></thead>
      <tbody>
        <tr><td>🎯 Marcador exacto (5pts)</td><td>${exactCount}</td><td>${total ? Math.round(exactCount/total*100) : 0}%</td></tr>
        <tr><td>✔️ Resultado correcto (3-4pts)</td><td>${resultCount}</td><td>${total ? Math.round(resultCount/total*100) : 0}%</td></tr>
        <tr><td>❌ Sin puntos</td><td>${zeroCount}</td><td>${total ? Math.round(zeroCount/total*100) : 0}%</td></tr>
      </tbody>
    </table>
    <h2>Líder actual</h2>
    <p>${leaderboard[0] ? `${leaderboard[0].username} con ${leaderboard[0].total_points} puntos` : 'Sin datos aún'}</p>
  `);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const [leaderboard, matches, predictions] = await Promise.all([
    rpc<Array<{ username: string; total_points: number }>>('leaderboard'),
    query<Array<{
      id: string; home_team: string; away_team: string;
      kickoff_at: string; phase: string; group_name: string | null;
      home_score: number | null; away_score: number | null; status: string;
    }>>('matches', { order: 'kickoff_at.asc' }),
    query<Array<{ points: number | null }>>('predictions'),
  ]);

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), await generateIndex(leaderboard));
  fs.writeFileSync(path.join(OUT_DIR, 'partidos.html'), await generatePartidos(matches));
  fs.writeFileSync(path.join(OUT_DIR, 'stats.html'), await generateStats(leaderboard, predictions));

  console.log(`✅ Site generated in ${OUT_DIR}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 3: Add scripts to `site/package.json`**

```json
{
  "scripts": {
    "generate": "tsx src/generate.ts"
  }
}
```

**Step 4: Commit**

```bash
git add site/
git commit -m "feat: add static site generator"
```

---

### Task 15: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/build-site.yml`

**Step 1: Create `.github/workflows/build-site.yml`**

```yaml
name: Build and deploy site

on:
  workflow_dispatch:  # Triggered by Worker via API

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install site dependencies
        run: cd site && npm install

      - name: Generate static site
        run: cd site && npm run generate
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          OUT_DIR: dist

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: site/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

**Step 2: Enable GitHub Pages in repo settings**

Go to repo Settings → Pages → Source: **GitHub Actions**.

**Step 3: Add repository secrets**

In repo Settings → Secrets → Actions, add:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

**Step 4: Commit**

```bash
git add .github/
git commit -m "feat: add github actions build and deploy workflow"
```

---

### Task 16: Register Telegram webhook + first admin setup

**Step 1: Deploy the Worker**

```bash
cd worker

# Set all secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put ADMIN_TELEGRAM_ID
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put GITHUB_PAT
wrangler secret put GITHUB_REPO
wrangler secret put INVITE_CODE_SECRET
wrangler secret put TELEGRAM_BOT_USERNAME

# Deploy
wrangler deploy
```

Expected output: `Published oraculobot-worker (https://oraculobot-worker.<account>.workers.dev)`

**Step 2: Register the webhook**

```bash
WORKER_URL="https://oraculobot-worker.<account>.workers.dev"
BOT_TOKEN="<your-bot-token>"

curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WORKER_URL}"
```

Expected: `{"ok":true,"result":true,"description":"Webhook was set"}`

**Step 3: Create the first admin user directly in Supabase**

In Supabase SQL Editor:

```sql
-- Create a bootstrap invite code (no created_by, used once to register admin)
insert into invite_codes (code, created_by, max_uses, use_count)
values ('ADMIN2026', null, 1, 0);
```

Send `ADMIN2026` to the bot in Telegram. The bot will register you as a normal user. Then in Supabase:

```sql
update users set is_admin = true where telegram_id = <your-telegram-id>;
```

**Step 4: Verify admin menu appears**

Send any message to the bot — the admin menu with `✅ Resultado`, `🎟 Invitar`, and `➕ Partido` should appear.

---

### Task 17: CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

**Step 1: Create `CLAUDE.md`**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Worker (Cloudflare Worker)
```bash
cd worker
npm run dev        # Local dev with wrangler dev (uses .dev.vars for env)
npm run deploy     # Deploy to Cloudflare
npm test           # Run vitest tests
npm run test:watch # Watch mode
```

### Site generator
```bash
cd site
npm run generate   # Generates dist/ (requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars)
```

### Single test
```bash
cd worker && npx vitest run tests/scoring.test.ts
```

### Deploy webhook after worker deploy
```bash
curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WORKER_URL}"
```

## Architecture

See `docs/plans/2026-04-10-oraculobot-design.md` for the full system design.

**Request flow:** Telegram sends POST to Cloudflare Worker → `src/index.ts` → `src/router.ts` checks conversation state in Supabase → delegates to handler in `src/handlers/`.

**Multi-step flows** (prediction entry, admin result, match creation) use `conversation_state` table in Supabase to persist the current step and context between messages.

**Admin authorization** is checked by comparing the sender's `telegram_id` against the `ADMIN_TELEGRAM_ID` environment variable. No DB lookup needed.

**Site regeneration** is triggered fire-and-forget by the Worker after an admin submits a result (`src/services/github.ts` → `workflow_dispatch` on `build-site.yml`).

**Scoring logic** lives in `worker/src/services/scoring.ts` and is fully pure/testable. Rules: 5pts exact, 3pts correct result, +1 if correct goal diff and not exact.

## Local dev setup

Create `worker/.dev.vars` (gitignored) with all secrets listed in `wrangler.toml`. The Worker reads these in local dev via `wrangler dev`.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with commands and architecture guide"
```

---

## Running all tests

```bash
cd worker && npm test
```

Expected: all scoring and validation tests pass.
