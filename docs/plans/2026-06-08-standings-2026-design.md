# Design: 2026 Standings Sync

## Goal

Expose live 2026 World Cup group standings in the question-answering bot. Users can ask "¿cómo va el grupo A?" or "¿cuántos puntos tiene Colombia?" and get up-to-date answers.

## Context

- `wc_squads_2026` and `wc_coaches_2026` already exist — 2026 squads and coaches are covered.
- The bot answers questions via DeepSeek + SQL against `wc_*` tables.
- `wc_group_standings` has historical data (1930–2022) but nothing for 2026.
- football-data.org free plan supports `WC` standings; 1 call returns all 12 groups at once.
- Rate limit: 10 calls/minute. The check-results workflow runs every 30 min and currently makes ~3 calls/run — well within limits.

## Chosen Approach: Sync to Supabase every 30 min (Option B)

Rejected alternatives:
- **Option A (compute from `matches`)**: SQL complex for DeepSeek; requires opening `matches` table to question system.
- **Option C (live fetch in worker)**: Latency per question; rate limit risk with concurrent users.

## Components

### 1. Migration — `wc_standings_2026`

```sql
create table wc_standings_2026 (
  id              serial primary key,
  group_name      text not null,        -- 'A'..'L'
  position        integer not null,     -- 1..4
  team            text not null,        -- exact name as in matches table
  played          integer not null default 0,
  wins            integer not null default 0,
  draws           integer not null default 0,
  losses          integer not null default 0,
  goals_for       integer not null default 0,
  goals_against   integer not null default 0,
  goal_difference integer not null default 0,
  points          integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (group_name, team)
);
alter table wc_standings_2026 enable row level security;
```

RLS enabled, no policies needed (service role only, same pattern as other `wc_*` tables).

### 2. Sync logic in `check-results.ts`

At the end of every run (unconditional — runs even if no matches were pending):

1. `GET /v4/competitions/WC/standings?season=2026` — 1 API call, returns all 12 groups.
2. Flatten `standings[].table[]` into rows, mapping football-data.org field names:
   - `entry.team.name` → `team`
   - `entry.playedGames` → `played`
   - `entry.won` → `wins`, `entry.draw` → `draws`, `entry.lost` → `losses`
   - `entry.goalsScored` → `goals_for`, `entry.goalsConceded` → `goals_against`
   - `entry.goalDifference` → `goal_difference`, `entry.points` → `points`
   - `group.group.replace('GROUP_', '')` → `group_name` (e.g. `'GROUP_A'` → `'A'`)
3. Upsert all rows via Supabase REST (`on_conflict=group_name,team`). Idempotent.
4. If the standings fetch fails, log and continue — match proposals already processed.

### 3. `wc-sql.ts` changes

Add `wc_standings_2026` to `ALLOWED_TABLES`.

Add to `WC_SCHEMA_PROMPT`:

```
wc_standings_2026(group_name, position, team, played, wins, draws, losses, goals_for, goals_against, goal_difference, points, updated_at)
  - group_name: 'A'..'L' (12 grupos en 2026)
  - team: nombre exacto como en matches

Ejemplos:
- Tabla del Grupo A: SELECT position, team, played, wins, draws, losses, goals_for, goals_against, points FROM wc_standings_2026 WHERE group_name = 'A' ORDER BY position
- Cómo va Colombia: SELECT group_name, position, points, played FROM wc_standings_2026 WHERE team = 'Colombia'
- Equipos clasificados (top 2 de cada grupo): SELECT group_name, team, points FROM wc_standings_2026 WHERE position <= 2 ORDER BY group_name
```

## Data flow

```
check-results.yml (every 30 min)
  → check-results.ts
    → football-data.org /standings  (1 call)
    → upsert wc_standings_2026 in Supabase

User question → worker → DeepSeek → SQL against wc_standings_2026 → answer
```

## Out of scope

- Knockout phase standings (not applicable, bracket handled separately).
- Third-place tiebreakers (position order from football-data.org is authoritative).
- Scorers sync (redundant with `wc_goals` populated via auto-results flow).
