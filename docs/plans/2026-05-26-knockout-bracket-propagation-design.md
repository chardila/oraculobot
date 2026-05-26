# Design: Knockout Bracket Propagation

**Date:** 2026-05-26  
**Status:** Approved

## Problem

Knockout round matches in the DB have placeholder team names (`"2A"`, `"W73"`, `"1E"`, etc.). As the tournament progresses, these placeholders must be replaced with real team names. For matches that go to extra time and penalties, the 90-minute score is a draw — the DB has no field to record who actually won on penalties, which is needed to know who advances.

## Scope

- **In scope:** Automatic propagation for all knockout rounds (Round of 32 → Round of 16 → Quarters → Semis → Final + Third place), including penalty winner capture.
- **Out of scope:** Group stage → Round of 32 resolution. The best-third logic (8 of 12 third-place teams, with FIFA's bracket assignment table) is too complex. This step is done manually via SQL once all group matches finish.

## Solution

### Database Changes

Two new nullable columns on `matches`:

- **`match_num integer`** — FIFA match number (1–104). Stable identifier used as the bracket map key. Populated via a one-time UPDATE migration comparing `home_team`/`away_team`/`kickoff_at` against `worldcup.json`.
- **`winner text check (winner in ('home', 'away'))`** — records who won. Set automatically when result is not a draw; set via penalty question when result is a draw in a knockout match. Null for group stage matches and unplayed matches.

### Bracket Map

Hardcoded in `worker/src/services/bracket.ts`:

```typescript
type BracketEntry = {
  nextMatchNum: number;
  as: 'home' | 'away';
  qualifier: 'winner' | 'loser';
};

const BRACKET_MAP: Record<number, BracketEntry[]> = {
  // Round of 32 → Round of 16
  73: [{nextMatchNum: 90, as: 'home', qualifier: 'winner'}],
  74: [{nextMatchNum: 89, as: 'home', qualifier: 'winner'}],
  75: [{nextMatchNum: 90, as: 'away', qualifier: 'winner'}],
  76: [{nextMatchNum: 91, as: 'home', qualifier: 'winner'}],
  77: [{nextMatchNum: 89, as: 'away', qualifier: 'winner'}],
  78: [{nextMatchNum: 91, as: 'away', qualifier: 'winner'}],
  79: [{nextMatchNum: 92, as: 'home', qualifier: 'winner'}],
  80: [{nextMatchNum: 92, as: 'away', qualifier: 'winner'}],
  81: [{nextMatchNum: 94, as: 'home', qualifier: 'winner'}],
  82: [{nextMatchNum: 94, as: 'away', qualifier: 'winner'}],
  83: [{nextMatchNum: 93, as: 'home', qualifier: 'winner'}],
  84: [{nextMatchNum: 93, as: 'away', qualifier: 'winner'}],
  85: [{nextMatchNum: 96, as: 'home', qualifier: 'winner'}],
  86: [{nextMatchNum: 95, as: 'home', qualifier: 'winner'}],
  87: [{nextMatchNum: 96, as: 'away', qualifier: 'winner'}],
  88: [{nextMatchNum: 95, as: 'away', qualifier: 'winner'}],
  // Round of 16 → Quarters
  89: [{nextMatchNum: 97, as: 'home', qualifier: 'winner'}],
  90: [{nextMatchNum: 97, as: 'away', qualifier: 'winner'}],
  91: [{nextMatchNum: 99, as: 'home', qualifier: 'winner'}],
  92: [{nextMatchNum: 99, as: 'away', qualifier: 'winner'}],
  93: [{nextMatchNum: 98, as: 'home', qualifier: 'winner'}],
  94: [{nextMatchNum: 98, as: 'away', qualifier: 'winner'}],
  95: [{nextMatchNum: 100, as: 'home', qualifier: 'winner'}],
  96: [{nextMatchNum: 100, as: 'away', qualifier: 'winner'}],
  // Quarters → Semis
  97: [{nextMatchNum: 101, as: 'home', qualifier: 'winner'}],
  98: [{nextMatchNum: 101, as: 'away', qualifier: 'winner'}],
  99: [{nextMatchNum: 102, as: 'home', qualifier: 'winner'}],
  100: [{nextMatchNum: 102, as: 'away', qualifier: 'winner'}],
  // Semis → Final + Third place
  101: [
    {nextMatchNum: 104, as: 'home', qualifier: 'winner'},
    {nextMatchNum: 103, as: 'home', qualifier: 'loser'},
  ],
  102: [
    {nextMatchNum: 104, as: 'away', qualifier: 'winner'},
    {nextMatchNum: 103, as: 'away', qualifier: 'loser'},
  ],
};
```

### Admin Bot Flow

No change to the existing result entry flow for group stage matches.

For knockout matches:

1. Admin selects match and sends score (e.g. `"2-1"`)
2. If result is **not a draw**: `winner` is set automatically (`'home'` or `'away'`), propagation runs immediately
3. If result is **a draw**: bot replies with inline buttons:
   > ⚽ **2-2** en 90 min. ¿Quién avanzó en penales?  
   > [🏠 Local (Equipo A)] [✈️ Visitante (Equipo B)]
4. Admin taps a button → `winner` saved, propagation runs

A new conversation step `awaiting_penalty_winner` holds `{match_id, home_team, away_team, home_score, away_score}` between the score entry and the penalty button tap.

Scoring (`scoring.ts`) is unchanged — points are always calculated on the 90-minute result.

### Propagation Logic

```
propagateBracket(match, winner, db):
  entries = BRACKET_MAP[match.match_num] ?? []
  for entry of entries:
    team = entry.qualifier === 'winner'
           ? (winner === 'home' ? match.home_team : match.away_team)
           : (winner === 'home' ? match.away_team : match.home_team)
    targetMatch = db.getMatchByNum(entry.nextMatchNum)
    db.updateMatchTeam(targetMatch.id, entry.as, team)
```

Propagation is fire-and-forget from the admin's perspective but awaited before confirming success. If it fails, the result and winner are already saved — a manual SQL fix can re-apply the propagation.

## Components Changed

| Component | Change |
|---|---|
| `supabase/migrations/012_knockout_bracket.sql` | Add `match_num`, `winner` columns; populate `match_num` for all 104 matches |
| `worker/src/services/bracket.ts` | New file: `BRACKET_MAP` + `propagateBracket()` |
| `worker/src/supabase.ts` | New methods: `getMatchByNum()`, `updateMatchTeam()`, `setMatchWinner()` |
| `worker/src/handlers/admin/result.ts` | New step `awaiting_penalty_winner`; auto-winner on non-draw knockouts; call `propagateBracket()` |

## Edge Cases

- **Propagation failure:** Result and winner already persisted. Reapply with SQL.
- **Double propagation:** `updateMatchTeam` is idempotent (same value overwrite).
- **Group stage draws:** No penalty question — condition on `match.phase !== 'grupos'`.
- **Matches 103/104:** Only receive propagation, never dispatch it. Not in `BRACKET_MAP`.
- **Rollback:** Not automated. Fix directly in Supabase dashboard.
