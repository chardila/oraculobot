# Knockout Bracket Propagation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When an admin enters the result of a knockout match, automatically update the next match's teams — asking for the penalty winner if the 90-minute score is a draw.

**Architecture:** Add `match_num` and `winner` columns to `matches`. A hardcoded `BRACKET_MAP` in a new `bracket.ts` service maps each knockout match number to the next match(es) it feeds. The existing admin result flow gains a new conversation step (`awaiting_penalty_winner`) that fires only for knockout draws.

**Tech Stack:** Cloudflare Workers, TypeScript, Supabase REST API, Vitest

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/012_knockout_bracket.sql`

**Step 1: Write the migration file**

```sql
-- Add match_num (stable FIFA match number, only set for knockout matches 73-104)
-- Add winner ('home' or 'away'), set when admin enters result
ALTER TABLE matches ADD COLUMN match_num integer;
ALTER TABLE matches ADD COLUMN winner text CHECK (winner IN ('home', 'away'));

-- Populate match_num for all 32 knockout matches using placeholder home_team
-- (these are the values in the DB before any results are entered)
UPDATE matches SET match_num = 73  WHERE home_team = '2A'   AND phase != 'grupos';
UPDATE matches SET match_num = 74  WHERE home_team = '1E'   AND phase != 'grupos';
UPDATE matches SET match_num = 75  WHERE home_team = '1F'   AND phase != 'grupos';
UPDATE matches SET match_num = 76  WHERE home_team = '1C'   AND phase != 'grupos';
UPDATE matches SET match_num = 77  WHERE home_team = '1I'   AND phase != 'grupos';
UPDATE matches SET match_num = 78  WHERE home_team = '2E'   AND phase != 'grupos';
UPDATE matches SET match_num = 79  WHERE home_team = '1A'   AND phase != 'grupos';
UPDATE matches SET match_num = 80  WHERE home_team = '1L'   AND phase != 'grupos';
UPDATE matches SET match_num = 81  WHERE home_team = '1D'   AND phase != 'grupos';
UPDATE matches SET match_num = 82  WHERE home_team = '1G'   AND phase != 'grupos';
UPDATE matches SET match_num = 83  WHERE home_team = '2K'   AND phase != 'grupos';
UPDATE matches SET match_num = 84  WHERE home_team = '1H'   AND phase != 'grupos';
UPDATE matches SET match_num = 85  WHERE home_team = '1B'   AND phase != 'grupos';
UPDATE matches SET match_num = 86  WHERE home_team = '1J'   AND phase != 'grupos';
UPDATE matches SET match_num = 87  WHERE home_team = '1K'   AND phase != 'grupos';
UPDATE matches SET match_num = 88  WHERE home_team = '2D'   AND phase != 'grupos';
UPDATE matches SET match_num = 89  WHERE home_team = 'W74'  AND phase != 'grupos';
UPDATE matches SET match_num = 90  WHERE home_team = 'W73'  AND phase != 'grupos';
UPDATE matches SET match_num = 91  WHERE home_team = 'W76'  AND phase != 'grupos';
UPDATE matches SET match_num = 92  WHERE home_team = 'W79'  AND phase != 'grupos';
UPDATE matches SET match_num = 93  WHERE home_team = 'W83'  AND phase != 'grupos';
UPDATE matches SET match_num = 94  WHERE home_team = 'W81'  AND phase != 'grupos';
UPDATE matches SET match_num = 95  WHERE home_team = 'W86'  AND phase != 'grupos';
UPDATE matches SET match_num = 96  WHERE home_team = 'W85'  AND phase != 'grupos';
UPDATE matches SET match_num = 97  WHERE home_team = 'W89'  AND phase != 'grupos';
UPDATE matches SET match_num = 98  WHERE home_team = 'W93'  AND phase != 'grupos';
UPDATE matches SET match_num = 99  WHERE home_team = 'W91'  AND phase != 'grupos';
UPDATE matches SET match_num = 100 WHERE home_team = 'W95'  AND phase != 'grupos';
UPDATE matches SET match_num = 101 WHERE home_team = 'W97'  AND phase != 'grupos';
UPDATE matches SET match_num = 102 WHERE home_team = 'W99'  AND phase != 'grupos';
UPDATE matches SET match_num = 103 WHERE home_team = 'L101' AND phase != 'grupos';
UPDATE matches SET match_num = 104 WHERE home_team = 'W101' AND phase != 'grupos';
```

**Step 2: Apply via Supabase dashboard**

Go to Supabase → SQL Editor → paste the migration → Run.
Verify: `SELECT match_num, home_team, away_team FROM matches WHERE match_num IS NOT NULL ORDER BY match_num;`
Expected: 32 rows, match_num 73–104, with placeholder team names.

**Step 3: Commit**

```bash
rtk git add supabase/migrations/012_knockout_bracket.sql
rtk git commit -m "feat: add match_num and winner columns to matches"
```

---

## Task 2: Update TypeScript types

**Files:**
- Modify: `worker/src/types.ts:85-96`

**Step 1: Add the two new fields to DbMatch**

In `worker/src/types.ts`, update the `DbMatch` interface:

```typescript
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
  ground: string | null;
  match_num: number | null;      // add this
  winner: 'home' | 'away' | null; // add this
}
```

**Step 2: Commit**

```bash
rtk git add worker/src/types.ts
rtk git commit -m "feat: add match_num and winner to DbMatch type"
```

---

## Task 3: New Supabase client methods

**Files:**
- Modify: `worker/src/supabase.ts` (after line 147, after `finishMatch`)

**Step 1: Add three methods after `finishMatch`**

```typescript
async getMatchByNum(matchNum: number): Promise<DbMatch | null> {
  const rows = await this.req<DbMatch[]>('matches', {}, {
    match_num: `eq.${matchNum}`,
    limit: '1',
  });
  return rows?.[0] ?? null;
}

async setMatchWinner(id: string, winner: 'home' | 'away'): Promise<void> {
  await this.req('matches', {
    method: 'PATCH',
    body: JSON.stringify({ winner }),
    headers: { 'Prefer': 'return=minimal' },
  }, { id: `eq.${id}` });
}

async updateMatchTeam(id: string, side: 'home' | 'away', team: string): Promise<void> {
  const field = side === 'home' ? 'home_team' : 'away_team';
  await this.req('matches', {
    method: 'PATCH',
    body: JSON.stringify({ [field]: team }),
    headers: { 'Prefer': 'return=minimal' },
  }, { id: `eq.${id}` });
}
```

**Step 2: Commit**

```bash
rtk git add worker/src/supabase.ts
rtk git commit -m "feat: add getMatchByNum, setMatchWinner, updateMatchTeam to SupabaseClient"
```

---

## Task 4: Bracket service with tests

**Files:**
- Create: `worker/src/services/bracket.ts`
- Create: `worker/tests/services/bracket.test.ts`

**Step 1: Write the failing tests**

Create `worker/tests/services/bracket.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getBracketEntries, resolveTeam } from '../../src/services/bracket';

describe('getBracketEntries', () => {
  it('returns empty array for group stage match (no match_num)', () => {
    expect(getBracketEntries(null)).toEqual([]);
  });

  it('returns empty array for match 103 and 104 (receive only)', () => {
    expect(getBracketEntries(103)).toEqual([]);
    expect(getBracketEntries(104)).toEqual([]);
  });

  it('match 73 winner goes to match 90 as home', () => {
    const entries = getBracketEntries(73);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ nextMatchNum: 90, as: 'home', qualifier: 'winner' });
  });

  it('match 77 winner goes to match 89 as away', () => {
    const entries = getBracketEntries(77);
    expect(entries[0]).toEqual({ nextMatchNum: 89, as: 'away', qualifier: 'winner' });
  });

  it('match 101 produces two entries: winner to final, loser to third place', () => {
    const entries = getBracketEntries(101);
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ nextMatchNum: 104, as: 'home', qualifier: 'winner' });
    expect(entries).toContainEqual({ nextMatchNum: 103, as: 'home', qualifier: 'loser' });
  });

  it('match 102 produces two entries: winner to final as away, loser to third place as away', () => {
    const entries = getBracketEntries(102);
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ nextMatchNum: 104, as: 'away', qualifier: 'winner' });
    expect(entries).toContainEqual({ nextMatchNum: 103, as: 'away', qualifier: 'loser' });
  });
});

describe('resolveTeam', () => {
  const match = { home_team: 'Brazil', away_team: 'Argentina' };

  it('returns home team when winner=home and qualifier=winner', () => {
    expect(resolveTeam(match, 'home', 'winner')).toBe('Brazil');
  });

  it('returns away team when winner=away and qualifier=winner', () => {
    expect(resolveTeam(match, 'away', 'winner')).toBe('Argentina');
  });

  it('returns away team when winner=home and qualifier=loser', () => {
    expect(resolveTeam(match, 'home', 'loser')).toBe('Argentina');
  });

  it('returns home team when winner=away and qualifier=loser', () => {
    expect(resolveTeam(match, 'away', 'loser')).toBe('Brazil');
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
cd worker && npx vitest run tests/services/bracket.test.ts
```

Expected: FAIL — `bracket.ts` does not exist yet.

**Step 3: Implement bracket.ts**

Create `worker/src/services/bracket.ts`:

```typescript
import type { SupabaseClient } from '../supabase';

export type BracketEntry = {
  nextMatchNum: number;
  as: 'home' | 'away';
  qualifier: 'winner' | 'loser';
};

const BRACKET_MAP: Record<number, BracketEntry[]> = {
  // Round of 32 → Round of 16
  73:  [{ nextMatchNum: 90,  as: 'home', qualifier: 'winner' }],
  74:  [{ nextMatchNum: 89,  as: 'home', qualifier: 'winner' }],
  75:  [{ nextMatchNum: 90,  as: 'away', qualifier: 'winner' }],
  76:  [{ nextMatchNum: 91,  as: 'home', qualifier: 'winner' }],
  77:  [{ nextMatchNum: 89,  as: 'away', qualifier: 'winner' }],
  78:  [{ nextMatchNum: 91,  as: 'away', qualifier: 'winner' }],
  79:  [{ nextMatchNum: 92,  as: 'home', qualifier: 'winner' }],
  80:  [{ nextMatchNum: 92,  as: 'away', qualifier: 'winner' }],
  81:  [{ nextMatchNum: 94,  as: 'home', qualifier: 'winner' }],
  82:  [{ nextMatchNum: 94,  as: 'away', qualifier: 'winner' }],
  83:  [{ nextMatchNum: 93,  as: 'home', qualifier: 'winner' }],
  84:  [{ nextMatchNum: 93,  as: 'away', qualifier: 'winner' }],
  85:  [{ nextMatchNum: 96,  as: 'home', qualifier: 'winner' }],
  86:  [{ nextMatchNum: 95,  as: 'home', qualifier: 'winner' }],
  87:  [{ nextMatchNum: 96,  as: 'away', qualifier: 'winner' }],
  88:  [{ nextMatchNum: 95,  as: 'away', qualifier: 'winner' }],
  // Round of 16 → Quarters
  89:  [{ nextMatchNum: 97,  as: 'home', qualifier: 'winner' }],
  90:  [{ nextMatchNum: 97,  as: 'away', qualifier: 'winner' }],
  91:  [{ nextMatchNum: 99,  as: 'home', qualifier: 'winner' }],
  92:  [{ nextMatchNum: 99,  as: 'away', qualifier: 'winner' }],
  93:  [{ nextMatchNum: 98,  as: 'home', qualifier: 'winner' }],
  94:  [{ nextMatchNum: 98,  as: 'away', qualifier: 'winner' }],
  95:  [{ nextMatchNum: 100, as: 'home', qualifier: 'winner' }],
  96:  [{ nextMatchNum: 100, as: 'away', qualifier: 'winner' }],
  // Quarters → Semis
  97:  [{ nextMatchNum: 101, as: 'home', qualifier: 'winner' }],
  98:  [{ nextMatchNum: 101, as: 'away', qualifier: 'winner' }],
  99:  [{ nextMatchNum: 102, as: 'home', qualifier: 'winner' }],
  100: [{ nextMatchNum: 102, as: 'away', qualifier: 'winner' }],
  // Semis → Final + Third place
  101: [
    { nextMatchNum: 104, as: 'home', qualifier: 'winner' },
    { nextMatchNum: 103, as: 'home', qualifier: 'loser'  },
  ],
  102: [
    { nextMatchNum: 104, as: 'away', qualifier: 'winner' },
    { nextMatchNum: 103, as: 'away', qualifier: 'loser'  },
  ],
};

export function getBracketEntries(matchNum: number | null): BracketEntry[] {
  if (matchNum === null) return [];
  return BRACKET_MAP[matchNum] ?? [];
}

export function resolveTeam(
  match: { home_team: string; away_team: string },
  winner: 'home' | 'away',
  qualifier: 'winner' | 'loser'
): string {
  const winnerTeam = winner === 'home' ? match.home_team : match.away_team;
  const loserTeam  = winner === 'home' ? match.away_team : match.home_team;
  return qualifier === 'winner' ? winnerTeam : loserTeam;
}

export async function propagateBracket(
  match: { match_num: number | null; home_team: string; away_team: string },
  winner: 'home' | 'away',
  db: SupabaseClient
): Promise<void> {
  const entries = getBracketEntries(match.match_num);
  await Promise.all(entries.map(async entry => {
    const team = resolveTeam(match, winner, entry.qualifier);
    const target = await db.getMatchByNum(entry.nextMatchNum);
    if (target) {
      await db.updateMatchTeam(target.id, entry.as, team);
    }
  }));
}
```

**Step 4: Run tests to confirm they pass**

```bash
cd worker && npx vitest run tests/services/bracket.test.ts
```

Expected: all 10 tests pass.

**Step 5: Commit**

```bash
rtk git add worker/src/services/bracket.ts worker/tests/services/bracket.test.ts
rtk git commit -m "feat: add bracket service with BRACKET_MAP, getBracketEntries, resolveTeam, propagateBracket"
```

---

## Task 5: Update result.ts — penalty winner flow

**Files:**
- Modify: `worker/src/handlers/admin/result.ts`

**Step 1: Add imports at the top of result.ts**

After the existing imports, add:

```typescript
import { propagateBracket } from '../../services/bracket';
```

**Step 2: Replace `handleAdminResultText` with the new version**

The key changes:
- After `finishMatch`, calculate winner from 90-min score if not a draw
- For knockout draws: save `awaiting_penalty_winner` state and ask penalty question
- For all others: set winner, propagate, then complete as before

Replace the entire `handleAdminResultText` function with:

```typescript
export async function handleAdminResultText(
  msg: TelegramMessage,
  state: ConversationState,
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

  const match = await db.getMatchById(ctx.match_id);
  if (!match || match.status === 'finished') {
    await db.clearConversationState(user.telegram_id!);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '⚠️ Este partido ya tiene resultado cargado.');
    return;
  }

  await db.finishMatch(ctx.match_id, homeScore, awayScore);

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

  const isDraw = homeScore === awayScore;
  const isKnockout = match.phase !== 'grupos';

  if (isKnockout && isDraw) {
    await db.setConversationState(user.telegram_id!, 'awaiting_penalty_winner', {
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      match_num: match.match_num,
    });
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `✅ <b>${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}</b>\n\n` +
      `📊 ${predictions.length} predicciones procesadas\n` +
      `🎯 ${exactCount} marcador exacto · ✔️ ${resultCount} resultado correcto\n\n` +
      `⚽ Empate en 90 min. ¿Quién avanzó en penales?`,
      [[
        { text: `🏠 ${match.home_team}`, callback_data: 'admin:penalty:home' },
        { text: `✈️ ${match.away_team}`, callback_data: 'admin:penalty:away' },
      ]]
    );
    return;
  }

  const winner: 'home' | 'away' = homeScore > awayScore ? 'home' : 'away';
  await db.setMatchWinner(match.id, winner);
  await propagateBracket(match, winner, db).catch(console.error);

  await db.clearConversationState(user.telegram_id!);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ <b>${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}</b>\n\n` +
    `📊 ${predictions.length} predicciones procesadas\n` +
    `🎯 ${exactCount} marcador exacto · ✔️ ${resultCount} resultado correcto\n\n` +
    `🔄 Regenerando sitio web...`
  );

  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(console.error);
}
```

Note: `sendMessage` needs to accept an optional inline keyboard. Check `worker/src/telegram.ts` — if sendMessage doesn't support a keyboard param, either add it or use a separate `sendMenu` call. Use `sendMenu` for the penalty question if needed.

**Step 3: Add the penalty winner handler (new exported function)**

Add this after `handleAdminResultText`:

```typescript
export async function handleAdminPenaltyWinner(
  winner: 'home' | 'away',
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const state = await db.getConversationState(user.telegram_id!);
  if (!state || state.step !== 'awaiting_penalty_winner') return;

  const ctx = state.context as {
    match_id: string;
    home_team: string;
    away_team: string;
    match_num: number | null;
  };

  await db.setMatchWinner(ctx.match_id, winner);
  await propagateBracket(ctx, winner, db).catch(console.error);
  await db.clearConversationState(user.telegram_id!);

  const winnerName = winner === 'home' ? ctx.home_team : ctx.away_team;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `🏆 <b>${winnerName}</b> avanzó en penales.\n\n🔄 Regenerando sitio web...`
  );

  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(console.error);
}
```

**Step 4: Run full test suite**

```bash
cd worker && npx vitest run
```

Expected: all tests pass (no existing test touches knockout flows).

**Step 5: Commit**

```bash
rtk git add worker/src/handlers/admin/result.ts
rtk git commit -m "feat: add penalty winner flow and bracket propagation to admin result handler"
```

---

## Task 6: Wire penalty callbacks in menu.ts

**Files:**
- Modify: `worker/src/handlers/menu.ts`

**Step 1: Add import**

At the top of `menu.ts`, add to the existing result import:

```typescript
import { startAdminResult, handleAdminResultSelect, handleAdminPenaltyWinner } from './admin/result';
```

**Step 2: Add penalty callback handling in `handleMenuCallback`**

Inside `handleMenuCallback`, after the `admin:result:` block (around line 60), add:

```typescript
if (data === 'admin:penalty:home' || data === 'admin:penalty:away') {
  if (!admin) return;
  const winner = data === 'admin:penalty:home' ? 'home' : 'away';
  await handleAdminPenaltyWinner(winner, chatId, user, db, env);
  return;
}
```

**Step 3: Check sendMessage signature in telegram.ts**

```bash
cd worker && grep -n 'sendMessage' src/telegram.ts | head -10
```

If `sendMessage` doesn't accept an inline keyboard, use `sendMenu` in the penalty question in result.ts instead. Update accordingly.

**Step 4: Run full test suite**

```bash
cd worker && npx vitest run
```

Expected: all tests pass.

**Step 5: Commit**

```bash
rtk git add worker/src/handlers/menu.ts
rtk git commit -m "feat: handle admin:penalty:home/away callbacks in menu router"
```

---

## Task 7: Check telegram.ts sendMessage signature

**Files:**
- Read: `worker/src/telegram.ts`

**Step 1: Check if sendMessage accepts a keyboard parameter**

Read `worker/src/telegram.ts`. If `sendMessage` only takes `(token, chatId, text)`, you need to either:

a) Add an optional `keyboard` param to `sendMessage`, or  
b) Replace the `sendMessage` call in `handleAdminResultText` (the penalty question) with `sendMenu`

Option (b) is simpler. Replace the penalty question message in `result.ts`:

```typescript
// Replace sendMessage(..., [[...]]) with sendMenu:
await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
  `✅ <b>${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}</b>\n\n` +
  `📊 ${predictions.length} predicciones procesadas\n` +
  `🎯 ${exactCount} marcador exacto · ✔️ ${resultCount} resultado correcto\n\n` +
  `⚽ Empate en 90 min. ¿Quién avanzó en penales?`,
  [[
    { text: `🏠 ${match.home_team}`, callback_data: 'admin:penalty:home' },
    { text: `✈️ ${match.away_team}`, callback_data: 'admin:penalty:away' },
  ]]
);
```

**Step 2: Run full test suite**

```bash
cd worker && npx vitest run
```

Expected: all tests pass.

**Step 3: Commit if any changes were needed**

```bash
rtk git add worker/src/handlers/admin/result.ts worker/src/telegram.ts
rtk git commit -m "fix: use sendMenu for penalty question inline keyboard"
```

---

## Task 8: Deploy and smoke test

**Step 1: Deploy to Cloudflare**

```bash
cd worker && npm run deploy
```

**Step 2: Manual smoke test checklist**

In the Telegram bot:
1. Admin selects a scheduled knockout match and enters a non-draw score (e.g. `2-1`)
   - Expected: confirmation message, NO penalty question
   - Verify in Supabase: `winner` column set to `'home'`, next match's `home_team` or `away_team` updated

2. Admin selects a scheduled knockout match and enters a draw score (e.g. `1-1`)
   - Expected: "Empate en 90 min" message with two inline buttons
   - Admin taps a button
   - Expected: confirmation with winner team name
   - Verify in Supabase: `winner` set, next match team updated

3. Admin enters a draw result for a group stage match
   - Expected: standard confirmation, NO penalty question

**Step 3: Commit if any fixes needed from smoke test**

---

## Notes for implementer

- **`propagateBracket` is fire-and-forget** with `.catch(console.error)`. If it fails, the result and winner are saved — fix manually via Supabase SQL.
- **Group stage matches** have `match_num = null`. `getBracketEntries(null)` returns `[]` so propagation is a no-op.
- **`sendMenu` vs `sendMessage`**: `sendMenu` sends a new message; `sendMessage` doesn't support keyboards. The penalty question needs a keyboard, so use `sendMenu`.
- **Callback flow**: penalty callbacks are `callback_query`, not text messages. They go through `handleMenuCallback` in menu.ts, not through `route`'s text-message switch.
- **`awaiting_penalty_winner` in router.ts**: This step is set in conversation state but is only resolved via a callback_query (button press), not a text message. No changes needed to `router.ts`'s switch statement.
