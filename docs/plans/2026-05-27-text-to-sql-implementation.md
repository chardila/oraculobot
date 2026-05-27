# Text-to-SQL WC History — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mover los datos históricos de Mundiales (1930–2022 + eliminatorias 2026) a tablas de Supabase y reemplazar el HISTORY_CONTEXT estático por consultas SQL generadas dinámicamente por DeepSeek.

**Architecture:** El handler de preguntas detecta si la pregunta es sobre historia mundialista (SQL flow: 2 llamadas DeepSeek + 1 query Supabase) o sobre la polla (flujo actual: 1 llamada DeepSeek con contexto en prompt). Un servicio `wc-sql.ts` encapsula el schema prompt, la validación de SQL y la ejecución via RPC. Los datos se cargan con un script one-shot `load-wc-history.ts`.

**Tech Stack:** TypeScript + tsx (data loader), Cloudflare Workers (worker), Supabase PostgREST RPC (SQL execution), DeepSeek Chat API, openfootball/worldcup.json GitHub API, martj42/international_results raw CSV.

---

### Task 1: Migración — crear tablas wc_* y función RPC

**Files:**
- Create: `supabase/migrations/014_wc_history_tables.sql`

**Step 1: Crear el archivo de migración**

```sql
-- supabase/migrations/014_wc_history_tables.sql

create table wc_matches (
  id          serial primary key,
  year        int not null,
  tournament  text not null,  -- 'FIFA World Cup' | 'FIFA World Cup qualification'
  phase       text,           -- 'Group A', 'Round of 16', 'Final', 'Qualifying', etc.
  home_team   text not null,
  away_team   text not null,
  home_score  int,            -- null = partido no jugado aún
  away_score  int,
  home_ht     int,            -- marcador al descanso
  away_ht     int,
  match_date  date,
  ground      text
);

create table wc_goals (
  id        serial primary key,
  match_id  int references wc_matches(id) on delete cascade,
  team      text not null,
  scorer    text not null,
  minute    int,
  penalty   boolean default false,
  own_goal  boolean default false
);

create table wc_teams (
  id            serial primary key,
  year          int not null,
  name          text not null,
  fifa_code     text,
  continent     text,
  confederation text,
  group_name    text
);

create table wc_stadiums (
  id        serial primary key,
  year      int not null,
  name      text not null,
  city      text,
  country   text,
  capacity  int
);

alter table wc_matches  enable row level security;
alter table wc_goals    enable row level security;
alter table wc_teams    enable row level security;
alter table wc_stadiums enable row level security;

-- RPC function para ejecutar SQL generado por el modelo
-- Solo puede ser llamada con service role (el worker la llama con SUPABASE_SERVICE_KEY)
create or replace function exec_wc_query(query text)
returns json
language plpgsql
security invoker
as $$
declare
  result json;
  lower_q text;
begin
  lower_q := trim(lower(query));

  -- Solo SELECT permitido
  if not (lower_q like 'select%') then
    raise exception 'Only SELECT queries allowed';
  end if;

  -- Bloquear keywords peligrosos
  if lower_q ~ '\y(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|pg_read|pg_write)\y' then
    raise exception 'Forbidden keyword in query';
  end if;

  execute 'select coalesce(json_agg(row_to_json(q)), ''[]''::json) from (' || query || ') q'
    into result;

  return result;
end;
$$;
```

**Step 2: Aplicar la migración**

```bash
cd /home/carlos-ardila/Documents/gitprojects/oraculobot
npx supabase db push  # si tienes CLI local
# O usar mcp__supabase__apply_migration con el contenido del archivo
```

**Step 3: Verificar con get_advisors**

Ejecutar `mcp__supabase__get_advisors` con `type: "security"` y confirmar que no hay nuevos ERRORs para las tablas `wc_*`.

**Step 4: Commit**

```bash
rtk git add supabase/migrations/014_wc_history_tables.sql
rtk git commit -m "feat: add wc_* tables and exec_wc_query RPC for text-to-SQL"
```

---

### Task 2: Script de carga de datos

**Files:**
- Create: `WorldCup2026/load-wc-history.ts`

El script descarga todos los datos de openfootball (1930–2022) y martj42 (eliminatorias 2026) e inserta en las tablas usando DELETE+INSERT por año (idempotente).

**Step 1: Crear el script**

```typescript
// WorldCup2026/load-wc-history.ts
// Run with: npx tsx load-wc-history.ts
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const GH_BASE      = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master';
const MARTJ_BASE   = 'https://raw.githubusercontent.com/martj42/international_results/master';

const WC_YEARS = [
  1930,1934,1938,1950,1954,1958,1962,1966,1970,
  1974,1978,1982,1986,1990,1994,1998,2002,2006,
  2010,2014,2018,2022,
];

// ── Supabase REST helpers ────────────────────────────────────────────────────

async function supaReq(path: string, options: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=minimal',
      ...(options.headers as Record<string,string> ?? {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${path} ${res.status}: ${txt}`);
  }
}

async function insert(table: string, rows: object[]) {
  if (rows.length === 0) return;
  // Insert in batches of 500 to avoid request size limits
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await supaReq(table, {
      method: 'POST',
      body: JSON.stringify(batch),
      headers: { 'Prefer': 'return=minimal' },
    });
  }
}

async function deleteByYear(table: string, year: number) {
  await supaReq(`${table}?year=eq.${year}`, { method: 'DELETE' });
}

async function deleteByTournament(table: string, tournament: string) {
  await supaReq(`${table}?tournament=eq.${encodeURIComponent(tournament)}`, { method: 'DELETE' });
}

// For goals: delete via match_ids
async function deleteGoalsForYear(year: number) {
  // Delete goals for all matches of a given year via RPC or subquery
  // Simpler: fetch match ids for the year, then delete goals where match_id in those ids
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/wc_matches?year=eq.${year}&select=id`,
    { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
  );
  const matches = await res.json() as { id: number }[];
  const ids = matches.map(m => m.id);
  if (ids.length === 0) return;
  await supaReq(`wc_goals?match_id=in.(${ids.join(',')})`, { method: 'DELETE' });
}

// ── openfootball loaders ─────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function loadWcYear(year: number) {
  process.stdout.write(`Loading ${year}... `);

  // Delete existing data for this year (idempotent)
  await deleteGoalsForYear(year);
  await deleteByYear('wc_matches', year);
  await deleteByYear('wc_teams', year);
  await deleteByYear('wc_stadiums', year);

  // Matches + goals
  const wc = await fetchJson(`${GH_BASE}/${year}/worldcup.json`);
  if (!wc) { console.log('SKIP (no data)'); return; }

  const matchRows: object[] = [];
  const goalRows: { tempMatchIdx: number; team: string; scorer: string; minute: number | null; penalty: boolean; own_goal: boolean }[] = [];

  for (const m of wc.matches) {
    matchRows.push({
      year,
      tournament: 'FIFA World Cup',
      phase: m.group ?? m.round,
      home_team: m.team1,
      away_team: m.team2,
      home_score: m.score?.ft?.[0] ?? null,
      away_score: m.score?.ft?.[1] ?? null,
      home_ht: m.score?.ht?.[0] ?? null,
      away_ht: m.score?.ht?.[1] ?? null,
      match_date: m.date ?? null,
      ground: m.ground ?? null,
    });

    const idx = matchRows.length - 1;
    for (const g of m.goals1 ?? []) {
      goalRows.push({ tempMatchIdx: idx, team: m.team1, scorer: g.name, minute: g.minute ?? null, penalty: !!g.penalty, own_goal: !!g.owngoal });
    }
    for (const g of m.goals2 ?? []) {
      goalRows.push({ tempMatchIdx: idx, team: m.team2, scorer: g.name, minute: g.minute ?? null, penalty: !!g.penalty, own_goal: !!g.owngoal });
    }
  }

  // Insert matches and get back their IDs
  const insertedRes = await fetch(`${SUPABASE_URL}/rest/v1/wc_matches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(matchRows),
  });
  const inserted = await insertedRes.json() as { id: number }[];

  // Insert goals with real match IDs
  const goalInserts = goalRows.map(g => ({
    match_id: inserted[g.tempMatchIdx].id,
    team: g.team,
    scorer: g.scorer,
    minute: g.minute,
    penalty: g.penalty,
    own_goal: g.own_goal,
  }));
  await insert('wc_goals', goalInserts);

  // Teams (only some years have this file)
  const teamsData = await fetchJson(`${GH_BASE}/${year}/worldcup.teams.json`);
  if (teamsData?.teams) {
    await insert('wc_teams', teamsData.teams.map((t: any) => ({
      year, name: t.name, fifa_code: t.code ?? null,
      continent: t.continent ?? null,
      confederation: t.assoc?.continental?.code ?? null,
      group_name: null,
    })));
  }

  // Stadiums (only some years)
  const stadData = await fetchJson(`${GH_BASE}/${year}/worldcup.stadiums.json`);
  if (stadData?.stadiums) {
    await insert('wc_stadiums', stadData.stadiums.map((s: any) => ({
      year, name: s.name, city: s.city ?? null,
      country: null, capacity: s.capacity ?? null,
    })));
  }

  console.log(`${matchRows.length} matches, ${goalInserts.length} goals`);
}

// ── martj42 CSV loaders ──────────────────────────────────────────────────────

async function loadQualifying() {
  process.stdout.write('Loading 2026 qualifying results... ');

  // Delete existing qualifying data
  await supaReq(
    `wc_matches?tournament=eq.${encodeURIComponent('FIFA World Cup qualification')}&year=eq.2026`,
    { method: 'DELETE' }
  );

  const csv = await fetch(`${MARTJ_BASE}/results.csv`).then(r => r.text());
  const lines = csv.split('\n').slice(1).filter(Boolean);

  const rows = lines
    .map(line => {
      const [date, home, away, hs, as_, tournament] = line.split(',');
      return { date, home, away, hs: Number(hs), as_: Number(as_), tournament };
    })
    .filter(r => r.date >= '2023-01-01' && r.tournament === 'FIFA World Cup qualification');

  const matchRows = rows.map(r => ({
    year: 2026,
    tournament: 'FIFA World Cup qualification',
    phase: 'Qualifying',
    home_team: r.home,
    away_team: r.away,
    home_score: isNaN(r.hs) ? null : r.hs,
    away_score: isNaN(r.as_) ? null : r.as_,
    home_ht: null,
    away_ht: null,
    match_date: r.date,
    ground: null,
  }));

  const insertedRes = await fetch(`${SUPABASE_URL}/rest/v1/wc_matches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(matchRows),
  });
  const inserted = await insertedRes.json() as { id: number; home_team: string; away_team: string; match_date: string }[];

  // Build lookup: "date|home|away" → match_id
  const matchLookup = new Map<string, number>();
  for (const m of inserted) {
    matchLookup.set(`${m.match_date}|${m.home_team}|${m.away_team}`, m.id);
  }

  console.log(`${matchRows.length} qualifying matches`);

  // Goals from goalscorers.csv
  process.stdout.write('Loading 2026 qualifying goalscorers... ');
  const gCsv = await fetch(`${MARTJ_BASE}/goalscorers.csv`).then(r => r.text());
  const gLines = gCsv.split('\n').slice(1).filter(Boolean);

  const goalRows: object[] = [];
  for (const line of gLines) {
    const [date, home, away, team, scorer, minute, own_goal, penalty] = line.split(',');
    if (date < '2023-01-01') continue;
    const matchId = matchLookup.get(`${date}|${home}|${away}`);
    if (!matchId) continue;
    goalRows.push({
      match_id: matchId,
      team,
      scorer,
      minute: minute ? Number(minute) : null,
      penalty: penalty?.trim() === 'TRUE',
      own_goal: own_goal?.trim() === 'TRUE',
    });
  }

  await insert('wc_goals', goalRows);
  console.log(`${goalRows.length} qualifying goals`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars');
  }

  for (const year of WC_YEARS) {
    await loadWcYear(year);
  }

  await loadQualifying();

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Ejecutar el script**

```bash
cd WorldCup2026
SUPABASE_URL=<url> SUPABASE_SERVICE_KEY=<key> npx tsx load-wc-history.ts
```

Esperar output como:
```
Loading 1930... 18 matches, 70 goals
Loading 1934... 17 matches, 70 goals
...
Loading 2022... 64 matches, 172 goals
Loading 2026 qualifying results... 901 qualifying matches
Loading 2026 qualifying goalscorers... 4537 qualifying goals
Done.
```

**Step 3: Verificar en Supabase que las tablas tienen datos**

```sql
SELECT year, COUNT(*) FROM wc_matches GROUP BY year ORDER BY year;
SELECT COUNT(*) FROM wc_goals;
```

**Step 4: Commit**

```bash
rtk git add WorldCup2026/load-wc-history.ts
rtk git commit -m "feat: add load-wc-history.ts script to populate wc_* tables"
```

---

### Task 3: Servicio wc-sql.ts — schema prompt + validación + ejecución

**Files:**
- Create: `worker/src/services/wc-sql.ts`

**Step 1: Crear el servicio**

```typescript
// worker/src/services/wc-sql.ts

const ALLOWED_TABLES = ['wc_matches', 'wc_goals', 'wc_teams', 'wc_stadiums'];

export const WC_SCHEMA_PROMPT = `
Tienes acceso a las siguientes tablas de base de datos con historia de Mundiales de Fútbol:

wc_matches(id, year, tournament, phase, home_team, away_team, home_score, away_score, home_ht, away_ht, match_date, ground)
  - year: número entero (1930, 1934, ..., 2022)
  - tournament: 'FIFA World Cup' o 'FIFA World Cup qualification'
  - phase: 'Group A'..'Group H', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final', 'Qualifying', etc.
  - home_score/away_score: null si el partido no se ha jugado
  - home_ht/away_ht: marcador al descanso (puede ser null)

wc_goals(id, match_id, team, scorer, minute, penalty, own_goal)
  - match_id: referencia a wc_matches.id
  - penalty: true/false
  - own_goal: true/false

wc_teams(id, year, name, fifa_code, continent, confederation, group_name)
  - confederation: 'UEFA', 'CONMEBOL', 'CONCACAF', 'CAF', 'AFC', 'OFC'
  - Solo disponible para años con datos de equipos (2014, 2018)

wc_stadiums(id, year, name, city, country, capacity)
  - Solo disponible para años con datos de estadios (2014, 2018, 2022)

Ejemplos de consultas:
- Goles de Messi en 2022: SELECT scorer, COUNT(*) as goles FROM wc_goals g JOIN wc_matches m ON g.match_id = m.id WHERE m.year = 2022 AND m.tournament = 'FIFA World Cup' AND g.scorer ILIKE '%Messi%' GROUP BY scorer
- Resultado final 2018: SELECT home_team, home_score, away_score, away_team FROM wc_matches WHERE year = 2018 AND phase = 'Final'
- Partidos de Colombia en eliminatorias: SELECT match_date, home_team, home_score, away_score, away_team FROM wc_matches WHERE year = 2026 AND tournament = 'FIFA World Cup qualification' AND (home_team = 'Colombia' OR away_team = 'Colombia') ORDER BY match_date
- Goleadores de un torneo: SELECT scorer, COUNT(*) as goles FROM wc_goals g JOIN wc_matches m ON g.match_id = m.id WHERE m.year = 2014 AND m.tournament = 'FIFA World Cup' AND g.own_goal = false GROUP BY scorer ORDER BY goles DESC LIMIT 10
`.trim();

export function validateWcSql(sql: string): { valid: boolean; error?: string } {
  const trimmed = sql.trim().toLowerCase();

  if (!trimmed.startsWith('select')) {
    return { valid: false, error: 'Query must start with SELECT' };
  }

  const forbidden = /\b(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|pg_)\b/;
  if (forbidden.test(trimmed)) {
    return { valid: false, error: 'Query contains forbidden keywords' };
  }

  // Check all referenced table names are in the allowed list
  const tableRefs = trimmed.match(/\bfrom\s+(\w+)|\bjoin\s+(\w+)/gi) ?? [];
  for (const ref of tableRefs) {
    const table = ref.replace(/\b(from|join)\s+/i, '').trim();
    if (!ALLOWED_TABLES.includes(table)) {
      return { valid: false, error: `Table "${table}" is not allowed` };
    }
  }

  return { valid: true };
}

export async function executeWcQuery(
  supabaseUrl: string,
  serviceKey: string,
  sql: string
): Promise<{ rows: unknown[]; error?: string }> {
  const validation = validateWcSql(sql);
  if (!validation.valid) {
    return { rows: [], error: validation.error };
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_wc_query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { rows: [], error: `DB error: ${text}` };
  }

  const rows = await res.json() as unknown[];
  return { rows: rows ?? [] };
}
```

**Step 2: Escribir tests de validación**

```typescript
// worker/tests/wc-sql.test.ts
import { describe, it, expect } from 'vitest';
import { validateWcSql } from '../src/services/wc-sql';

describe('validateWcSql', () => {
  it('accepts valid SELECT', () => {
    const r = validateWcSql('SELECT * FROM wc_matches WHERE year = 2018');
    expect(r.valid).toBe(true);
  });

  it('rejects non-SELECT', () => {
    const r = validateWcSql('DELETE FROM wc_matches');
    expect(r.valid).toBe(false);
  });

  it('rejects disallowed table', () => {
    const r = validateWcSql('SELECT * FROM users');
    expect(r.valid).toBe(false);
  });

  it('rejects forbidden keywords inside SELECT', () => {
    const r = validateWcSql('SELECT * FROM wc_matches; DROP TABLE users');
    expect(r.valid).toBe(false);
  });

  it('accepts JOIN between allowed tables', () => {
    const r = validateWcSql(
      'SELECT scorer FROM wc_goals JOIN wc_matches ON wc_goals.match_id = wc_matches.id WHERE year = 2022'
    );
    expect(r.valid).toBe(true);
  });
});
```

**Step 3: Correr los tests**

```bash
cd worker && npx vitest run tests/wc-sql.test.ts
```

Esperado: 5 passing.

**Step 4: Commit**

```bash
rtk git add worker/src/services/wc-sql.ts worker/tests/wc-sql.test.ts
rtk git commit -m "feat: add wc-sql service with schema prompt, validation and executeWcQuery"
```

---

### Task 4: Actualizar question.ts con flujo text-to-SQL

**Files:**
- Modify: `worker/src/handlers/web/question.ts`

El flujo nuevo:
1. Construir polla context (igual que hoy, sin HISTORY_CONTEXT)
2. Primera llamada a DeepSeek: instrucción de responder con `SQL: <query>` para preguntas históricas, o respuesta directa para preguntas de la polla
3. Si respuesta empieza con `SQL:`: ejecutar query y segunda llamada a DeepSeek con los resultados
4. Si es respuesta directa: devolverla

**Step 1: Reemplazar el contenido de question.ts**

```typescript
import type { Env, WebQuestionRequest } from '../../types';
import { SupabaseClient } from '../../supabase';
import { authenticate, AuthError } from '../../middleware/auth';
import { askDeepSeek } from '../../services/deepseek';
import { sanitizeUsername } from '../../services/sanitize';
import { VENUE_CONTEXT } from '../../services/worldcup-venues';
import { WC_SCHEMA_PROMPT, executeWcQuery } from '../../services/wc-sql';

const QUESTIONS_PER_DAY = 20;

export async function handleWebQuestion(request: Request, env: Env): Promise<Response> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  let user;
  try {
    user = await authenticate(request, env, db);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  let body: WebQuestionRequest;
  try {
    body = await request.json() as WebQuestionRequest;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.question?.trim()) {
    return Response.json({ error: 'La pregunta no puede estar vacía' }, { status: 400 });
  }
  if (body.question.length > 500) {
    return Response.json({ error: 'La pregunta no puede superar 500 caracteres' }, { status: 400 });
  }

  db.insertQuestionLog(user.id, body.question).catch(() => {});

  const today = new Date().toISOString().slice(0, 10);
  let questionsToday = user.questions_today;
  if (!user.questions_reset_at || user.questions_reset_at < today) {
    await db.setQuestionsToday(user.id, 0, today);
    questionsToday = 0;
  }
  if (questionsToday >= QUESTIONS_PER_DAY) {
    return Response.json({ error: `Alcanzaste el límite de ${QUESTIONS_PER_DAY} preguntas por día` }, { status: 429 });
  }
  await db.setQuestionsToday(user.id, questionsToday + 1);

  try {
    const [leaderboard, allMatches, recent, myPredictions] = await Promise.all([
      db.getLeaderboard(user.league_id),
      db.getAllMatches(),
      db.getRecentFinished(5),
      db.getUserPredictions(user.id),
    ]);

    const leaderboardText = leaderboard.slice(0, 10)
      .map((r, i) => `${i + 1}. ${sanitizeUsername(r.username)}: ${r.total_points} pts`)
      .join('\n');

    const scheduleText = allMatches.map(m => {
      const d = new Date(m.kickoff_at).toLocaleString('es-CO', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Bogota',
      });
      return m.status === 'finished'
        ? `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team} (${d}) [finalizado]`
        : `${m.home_team} vs ${m.away_team} (${d}) [${m.phase}${m.group_name ? ' Grupo ' + m.group_name : ''}]`;
    }).join('\n');

    const recentText = recent
      .map(m => `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`)
      .join('\n');

    const myPredictionsText = myPredictions.length === 0
      ? 'Sin predicciones aún.'
      : myPredictions.map(p => {
          const d = new Date(p.kickoff_at).toLocaleString('es-CO', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            timeZone: 'America/Bogota',
          });
          const result = p.status === 'finished'
            ? ` | Resultado: ${p.actual_home}-${p.actual_away} | Puntos: ${p.points ?? 'pendiente'}`
            : ' | Pendiente';
          return `${p.home_team} vs ${p.away_team} (${d}): predije ${p.predicted_home}-${p.predicted_away}${result}`;
        }).join('\n');

    // ── Primera llamada: clasificar pregunta y/o generar SQL ─────────────────
    const systemPrompt1 =
      `Eres el asistente del torneo de predicciones del Mundial 2026.\n` +
      `Responde siempre en español, de forma breve y directa. No uses markdown.\n` +
      `Solo puedes responder sobre Mundiales de fútbol o la polla. Si te preguntan otra cosa, responde exactamente: "Solo puedo responder preguntas sobre Mundiales de fútbol y la polla."\n\n` +
      `REGLA IMPORTANTE: Si la pregunta es sobre historia de Mundiales (partidos, goles, goleadores, grupos, clasificaciones, estadios, eliminatorias), responde ÚNICAMENTE con:\n` +
      `SQL: <consulta SQL aquí>\n` +
      `No añadas nada más. El SQL debe usar solo las tablas disponibles.\n\n` +
      `Si la pregunta es sobre la polla (predicciones, puntos, ranking), responde directamente usando el contexto.\n\n` +
      `${WC_SCHEMA_PROMPT}\n\n` +
      `CONTEXTO POLLA:\n` +
      `Fecha: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n` +
      `Usuario: ${sanitizeUsername(user.username)}\n` +
      `Mis predicciones:\n${myPredictionsText}\n\n` +
      `Leaderboard:\n${leaderboardText || 'Sin puntos aún.'}\n\n` +
      `Calendario 2026:\n${scheduleText || 'Sin partidos.'}\n\n` +
      `Resultados recientes:\n${recentText || 'Sin resultados aún.'}\n\n` +
      `Estadios 2026:\n${VENUE_CONTEXT}`;

    const response1 = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt1, body.question);

    // ── Si el modelo generó SQL, ejecutarlo y hacer segunda llamada ──────────
    if (response1.trimStart().toUpperCase().startsWith('SQL:')) {
      const sql = response1.replace(/^SQL:\s*/i, '').trim();
      let { rows, error } = await executeWcQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, sql);

      // Reintentar una vez si hubo error
      if (error) {
        const retry = await askDeepSeek(
          env.DEEPSEEK_API_KEY,
          systemPrompt1,
          `${body.question}\n\n(El SQL anterior falló con error: ${error}. Genera un SQL corregido.)`
        );
        if (retry.trimStart().toUpperCase().startsWith('SQL:')) {
          const retrySql = retry.replace(/^SQL:\s*/i, '').trim();
          ({ rows, error } = await executeWcQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, retrySql));
        }
      }

      if (error || rows.length === 0) {
        const systemPrompt2 =
          `Eres el asistente del torneo de predicciones del Mundial 2026. Responde en español, breve y directo. No uses markdown.\n` +
          `La consulta no devolvió resultados. Informa al usuario que no tienes esa información.`;
        const answer = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt2, body.question);
        return Response.json({ answer });
      }

      // Segunda llamada: convertir resultados a respuesta en español
      const resultsText = JSON.stringify(rows, null, 2);
      const systemPrompt2 =
        `Eres el asistente del torneo de predicciones del Mundial 2026. Responde en español, breve y directo. No uses markdown.\n` +
        `El usuario preguntó: "${body.question}"\n` +
        `Los datos de la base de datos son:\n${resultsText}\n` +
        `Responde la pregunta usando solo esos datos.`;

      const answer = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt2, body.question);
      return Response.json({ answer });
    }

    // ── Respuesta directa (preguntas de polla) ───────────────────────────────
    return Response.json({ answer: response1 });

  } catch (e) {
    console.error('question web error:', e);
    return Response.json({ error: 'No pude procesar tu pregunta, intenta de nuevo' }, { status: 500 });
  }
}
```

**Step 2: Eliminar imports que ya no se usan**

Verificar que `HISTORY_CONTEXT` ya no se importa en `question.ts`. El import de `worldcup-history.ts` se elimina.

**Step 3: Correr typecheck**

```bash
cd worker && npx tsc --noEmit 2>&1 | grep "src/"
```

Esperado: sin errores en archivos `src/`.

**Step 4: Commit**

```bash
rtk git add worker/src/handlers/web/question.ts
rtk git commit -m "feat: replace HISTORY_CONTEXT with text-to-SQL for WC history questions"
```

---

### Task 5: Deploy y pruebas manuales

**Step 1: Ejecutar script de carga**

```bash
cd WorldCup2026
SUPABASE_URL=$(grep SUPABASE_URL ../.env 2>/dev/null || echo "pegar URL") \
SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_KEY ../.env 2>/dev/null || echo "pegar KEY") \
npx tsx load-wc-history.ts
```

Verificar que imprime filas por cada año y no errores.

**Step 2: Desplegar worker**

```bash
cd worker && npm run deploy
```

**Step 3: Verificar en la web las siguientes preguntas de prueba**

| Pregunta | Espera SQL | Respuesta esperada |
|---|---|---|
| ¿Cuántos goles marcó Messi en todos los mundiales? | Sí | Suma de 2014+2018+2022 |
| ¿Cómo quedó Colombia en las eliminatorias 2026? | Sí | Tabla con resultados |
| ¿Quién fue el máximo goleador del Mundial 1930? | Sí | Guillermo Stábile (8 goles) |
| ¿Cuántos puntos tengo yo? | No (polla) | Respuesta directa del contexto |
| ¿Quién ganó el Mundial 1966? | Sí | England |

**Step 4: Push final**

```bash
rtk git push
```

---

### Notas importantes

- **Goalscorer data**: No todos los años tienen goles (solo 1930-1938, 1950, 1990, 2006, 2014, 2018, 2022). Para otros años el modelo debe responder que no tiene esa información detallada.
- **Idempotencia**: El script de carga se puede re-ejecutar sin problema (DELETE + INSERT por año).
- **HISTORY_CONTEXT**: Queda en el codebase (`worldcup-history.ts`) pero ya no se importa en `question.ts`. Se puede eliminar en un cleanup posterior.
- **Límite Supabase free tier**: ~10,800 filas = ~2MB << 500MB del free tier.
