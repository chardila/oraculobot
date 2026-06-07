# Auto-Results Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatizar la carga de resultados usando football-data.org con aprobación manual del admin por Telegram, precedido de un comando de recalcular partido para correcciones.

**Architecture:** Dos partes independientes. Parte 1 agrega un flujo Telegram admin para corregir resultados ya cargados (recalcula puntos con el marcador correcto). Parte 2 agrega un GitHub Actions cron que detecta partidos terminados vía football-data.org, almacena la propuesta en Supabase, y envía al admin un mensaje Telegram con todos los detalles (90min, ET, penales) pidiendo aprobación antes de tocar la BD de la polla.

**Tech Stack:** TypeScript, Cloudflare Workers, Supabase (PostgreSQL), Telegram Bot API inline keyboards, football-data.org API v4, GitHub Actions.

---

## Context rápido para el implementador

Antes de empezar, leer:
- `CLAUDE.md` — arquitectura completa, comandos de dev/deploy, convenciones de migración
- `worker/src/handlers/admin/result.ts` — flujo actual de carga de resultados (este plan extiende ese patrón exacto)
- `worker/src/services/scoring.ts` — `calculatePoints()` pura, se reutiliza sin cambios
- `worker/src/router.ts` — cómo se enrutan los estados de conversación Telegram
- `worker/src/types.ts` — interfaz `ConversationState` con sus `step` values
- `worker/src/supabase.ts` — `SupabaseClient` con todos los métodos DB existentes

Dev workflow:
```bash
cd worker && npm run dev          # local con wrangler
cd worker && npm test             # vitest
cd worker && npm run deploy       # deploy a Cloudflare
```

Siempre crear rama de feature antes de empezar:
```bash
git checkout -b feature/recalculate-match   # Parte 1
git checkout -b feature/auto-results        # Parte 2
```

---

## PARTE 1 — Recalcular partido (independiente)

### Task 1: Agregar método DB para listar partidos terminados

**Archivos:**
- Modificar: `worker/src/supabase.ts`

**Contexto:** Ya existe `getFinishedWithPastKickoff()` que retorna partidos SIN resultado. Necesitamos el opuesto: partidos CON resultado para poder recalcularlos.

**Step 1: Agregar método `getFinishedMatches()`**

En `worker/src/supabase.ts`, buscar `getFinishedWithPastKickoff` y agregar después:

```typescript
async getFinishedMatches(): Promise<Match[]> {
  return this.req<Match[]>('matches', {
    method: 'GET',
  }, { status: 'eq.finished', order: 'kickoff_at.desc', limit: '30' });
}
```

**Step 2: Commit**
```bash
git add worker/src/supabase.ts
git commit -m "feat: add getFinishedMatches DB method for recalculate flow"
```

---

### Task 2: Crear handler de recalcular

**Archivos:**
- Crear: `worker/src/handlers/admin/recalculate.ts`

**Step 1: Crear el archivo con el flujo completo**

```typescript
import type { TelegramMessage, Env, DbUser, ConversationState } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { sendMessage, sendMenu, editMenu } from '../../telegram';
import { calculatePoints } from '../../services/scoring';
import { triggerSiteBuild } from '../../services/github';
import { propagateBracket } from '../../services/bracket';

export async function startAdminRecalculate(
  chatId: number,
  msgId: number,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const matches = await db.getFinishedMatches();

  if (matches.length === 0) {
    await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
      '📭 No hay partidos con resultado cargado.',
      [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
    );
    return;
  }

  const buttons = matches.map(m => ([{
    text: `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`,
    callback_data: `admin:recalc:${m.id}`,
  }]));
  buttons.push([{ text: '🔙 Menú', callback_data: 'menu:main' }]);

  await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
    '🔄 <b>¿Cuál partido quieres recalcular?</b>',
    buttons
  );
}

export async function handleAdminRecalcSelect(
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

  await db.setConversationState(user.telegram_id!, 'awaiting_recalc_score', {
    match_id: match.id,
    home_team: match.home_team,
    away_team: match.away_team,
    old_home: match.home_score,
    old_away: match.away_score,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `🔄 <b>${match.home_team} vs ${match.away_team}</b>\n` +
    `Marcador actual: <code>${match.home_score}-${match.away_score}</code>\n\n` +
    `¿Cuál es el marcador correcto? Envía: <code>local-visitante</code>`
  );
}

const SCORE_REGEX = /^(\d{1,2})-(\d{1,2})$/;

export async function handleAdminRecalcText(
  msg: TelegramMessage,
  state: ConversationState,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? '';
  const ctx = state.context as {
    match_id: string; home_team: string; away_team: string;
    old_home: number; old_away: number;
  };

  const scoreMatch = SCORE_REGEX.exec(text);
  if (!scoreMatch) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Formato inválido. Usa <code>2-1</code>');
    return;
  }

  const homeScore = parseInt(scoreMatch[1]);
  const awayScore = parseInt(scoreMatch[2]);

  // Guardar nuevo score en contexto y pedir confirmación
  await db.setConversationState(user.telegram_id!, 'awaiting_recalc_confirm', {
    ...ctx,
    new_home: homeScore,
    new_away: awayScore,
  });

  await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
    `🔄 <b>Confirmar corrección</b>\n\n` +
    `${ctx.home_team} vs ${ctx.away_team}\n` +
    `Antes: <code>${ctx.old_home}-${ctx.old_away}</code>\n` +
    `Nuevo: <code>${homeScore}-${awayScore}</code>\n\n` +
    `⚠️ Se recalcularán puntos de todos los participantes.`,
    [[
      { text: '✅ Confirmar', callback_data: 'admin:recalc:confirm' },
      { text: '❌ Cancelar', callback_data: 'menu:main' },
    ]]
  );
}

export async function handleAdminRecalcConfirm(
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const state = await db.getConversationState(user.telegram_id!);
  if (!state || state.step !== 'awaiting_recalc_confirm') return;

  const ctx = state.context as {
    match_id: string; home_team: string; away_team: string;
    new_home: number; new_away: number;
  };

  const { new_home: homeScore, new_away: awayScore } = ctx;
  const match = await db.getMatchById(ctx.match_id);
  if (!match) {
    await db.clearConversationState(user.telegram_id!);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Partido no encontrado.');
    return;
  }

  // Actualizar marcador
  await db.finishMatch(ctx.match_id, homeScore, awayScore);

  // Recalcular puntos de todas las predicciones
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
    await db.setConversationState(user.telegram_id!, 'awaiting_recalc_penalty_winner', {
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      match_num: match.match_num,
    });
    await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
      `✅ Marcador corregido. ${predictions.length} predicciones recalculadas.\n` +
      `🎯 ${exactCount} exacto · ✔️ ${resultCount} resultado correcto\n\n` +
      `⚽ Empate — ¿quién avanzó en penales?`,
      [[
        { text: `🏠 ${match.home_team}`, callback_data: 'admin:recalc:penalty:home' },
        { text: `✈️ ${match.away_team}`, callback_data: 'admin:recalc:penalty:away' },
      ]]
    );
    return;
  }

  const winner: 'home' | 'away' = homeScore > awayScore ? 'home' : 'away';
  await db.setMatchWinner(match.id, winner);
  await propagateBracket(match, winner, db).catch(console.error);
  await db.clearConversationState(user.telegram_id!);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ <b>${ctx.home_team} ${homeScore} - ${awayScore} ${ctx.away_team}</b>\n` +
    `📊 ${predictions.length} predicciones recalculadas\n` +
    `🎯 ${exactCount} exacto · ✔️ ${resultCount} resultado correcto\n\n` +
    `🔄 Regenerando sitio web...`
  );

  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(console.error);
}

export async function handleAdminRecalcPenaltyWinner(
  winner: 'home' | 'away',
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const state = await db.getConversationState(user.telegram_id!);
  if (!state || state.step !== 'awaiting_recalc_penalty_winner') return;

  const ctx = state.context as {
    match_id: string; home_team: string; away_team: string; match_num: number | null;
  };

  await db.setMatchWinner(ctx.match_id, winner);
  await propagateBracket(ctx, winner, db).catch(console.error);
  await db.clearConversationState(user.telegram_id!);

  const winnerName = winner === 'home' ? ctx.home_team : ctx.away_team;
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `🏆 <b>${winnerName}</b> mantiene el avance en penales.\n🔄 Regenerando sitio web...`
  );
  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(console.error);
}
```

**Step 2: Commit**
```bash
git add worker/src/handlers/admin/recalculate.ts
git commit -m "feat: add recalculate match handler"
```

---

### Task 3: Agregar estados al tipo ConversationState y al router

**Archivos:**
- Modificar: `worker/src/types.ts`
- Modificar: `worker/src/router.ts`

**Step 1: Agregar steps al tipo en types.ts**

Buscar la definición de `ConversationState` (o el type de `step`). Agregar los nuevos steps:
```typescript
// Agregar a los step values existentes:
| 'awaiting_recalc_score'
| 'awaiting_recalc_confirm'
| 'awaiting_recalc_penalty_winner'
```

**Step 2: Agregar routing en router.ts**

Buscar el bloque donde se enrutan los `callback_data` y los estados de conversación. Seguir exactamente el mismo patrón que `admin:result`. Agregar:

```typescript
// En el bloque de callback_data:
if (data.startsWith('admin:recalc:')) {
  const sub = data.replace('admin:recalc:', '');
  if (sub === 'confirm') {
    return handleAdminRecalcConfirm(chatId, user, db, env);
  }
  if (sub === 'penalty:home') {
    return handleAdminRecalcPenaltyWinner('home', chatId, user, db, env);
  }
  if (sub === 'penalty:away') {
    return handleAdminRecalcPenaltyWinner('away', chatId, user, db, env);
  }
  // Es un match ID
  return handleAdminRecalcSelect(sub, chatId, user, db, env);
}

// En el bloque de conversation state dispatch:
if (step === 'awaiting_recalc_score') {
  return handleAdminRecalcText(msg, state, user, db, env);
}
```

**Step 3: Agregar al menú admin**

Buscar en `worker/src/handlers/admin/` o `worker/src/handlers/menu.ts` donde se define el menú admin y agregar el botón "Recalcular partido" con `callback_data: 'admin:recalc:start'`.

En router.ts agregar:
```typescript
if (data === 'admin:recalc:start') {
  return startAdminRecalculate(chatId, msgId, db, env);
}
```

**Step 4: Commit**
```bash
git add worker/src/types.ts worker/src/router.ts
git commit -m "feat: wire recalculate flow into router and admin menu"
```

---

### Task 4: Deploy y prueba manual Parte 1

```bash
cd worker && npm run deploy
```

Prueba en Telegram:
1. Admin abre menú → "Recalcular partido"
2. Selecciona un partido terminado
3. Entra marcador correcto
4. Confirma
5. Verificar en Supabase que `predictions.points` cambió correctamente:
   ```sql
   SELECT p.predicted_home, p.predicted_away, p.points
   FROM predictions p
   WHERE p.match_id = '<id del partido>'
   ORDER BY p.points DESC;
   ```

**Step: Commit y PR**
```bash
git push -u origin feature/recalculate-match
gh pr create --title "feat: add recalculate match admin command"
```

---

## PARTE 2 — Auto-resultados con football-data.org

### Prerequisito: Obtener API key

Registrarse en https://www.football-data.org/client/register y obtener el API token gratuito. Guardarlo como secret en GitHub (`FOOTBALL_DATA_TOKEN`) y en `worker/.dev.vars` para pruebas locales.

Verificar que el plan gratuito cubre el Mundial 2026:
```bash
curl "https://api.football-data.org/v4/competitions/WC/matches?season=2026&status=FINISHED" \
  -H "X-Auth-Token: <TOKEN>" | jq '.matches | length'
```
Debe retornar partidos (cuando haya). Si responde 403 o error de plan, el Mundial no está incluido y hay que explorar otro proveedor.

---

### Task 5: Migración — tabla proposed_results

**Archivos:**
- Crear: `supabase/migrations/025_proposed_results.sql`

```sql
create table proposed_results (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id),
  -- Marcador a 90 minutos (lo que se carga en la polla)
  home_score_90 int not null,
  away_score_90 int not null,
  -- Tiempo extra (null si no hubo)
  home_score_et int,
  away_score_et int,
  -- Penales shootout (null si no hubo)
  home_penalties int,
  away_penalties int,
  -- Ganador en caso de knockout con empate
  penalty_winner text check (penalty_winner in ('home', 'away')),
  -- Estado de la propuesta
  status        text not null default 'pending'
                check (status in ('pending', 'confirmed', 'rejected')),
  -- Para editar/eliminar el mensaje Telegram después de la decisión
  telegram_message_id bigint,
  proposed_at   timestamptz not null default now(),
  decided_at    timestamptz
);

alter table proposed_results enable row level security;
-- Accedida solo por el worker con service role, no necesita policies.
```

Aplicar:
```bash
# Via MCP supabase apply_migration, o manualmente desde el dashboard
```

**Step: Commit**
```bash
git add supabase/migrations/025_proposed_results.sql
git commit -m "feat: add proposed_results table for auto-result approval flow"
```

---

### Task 6: Métodos DB para proposed_results

**Archivos:**
- Modificar: `worker/src/supabase.ts`
- Modificar: `worker/src/types.ts` (agregar interfaz `ProposedResult`)

**Step 1: Agregar interfaz en types.ts**

```typescript
export interface ProposedResult {
  id: string;
  match_id: string;
  home_score_90: number;
  away_score_90: number;
  home_score_et: number | null;
  away_score_et: number | null;
  home_penalties: number | null;
  away_penalties: number | null;
  penalty_winner: 'home' | 'away' | null;
  status: 'pending' | 'confirmed' | 'rejected';
  telegram_message_id: number | null;
}
```

**Step 2: Agregar métodos en supabase.ts**

```typescript
async insertProposedResult(proposal: Omit<ProposedResult, 'id' | 'status'>): Promise<ProposedResult> {
  return this.req<ProposedResult>('proposed_results', {
    method: 'POST',
    body: JSON.stringify(proposal),
    headers: { 'Prefer': 'return=representation' },
  });
}

async updateProposedResultMessageId(id: string, messageId: number): Promise<void> {
  await this.req<void>('proposed_results', {
    method: 'PATCH',
    body: JSON.stringify({ telegram_message_id: messageId }),
    headers: { 'Prefer': 'return=minimal' },
  }, { id: `eq.${id}` });
}

async getProposedResult(id: string): Promise<ProposedResult | null> {
  const rows = await this.req<ProposedResult[]>('proposed_results', {
    method: 'GET',
  }, { id: `eq.${id}`, status: 'eq.pending' });
  return rows[0] ?? null;
}

async decideProposedResult(id: string, status: 'confirmed' | 'rejected'): Promise<void> {
  await this.req<void>('proposed_results', {
    method: 'PATCH',
    body: JSON.stringify({ status, decided_at: new Date().toISOString() }),
    headers: { 'Prefer': 'return=minimal' },
  }, { id: `eq.${id}` });
}

async hasPendingProposal(matchId: string): Promise<boolean> {
  const rows = await this.req<{ id: string }[]>('proposed_results', {
    method: 'GET',
  }, { match_id: `eq.${matchId}`, status: 'eq.pending' });
  return rows.length > 0;
}
```

**Step: Commit**
```bash
git add worker/src/types.ts worker/src/supabase.ts
git commit -m "feat: add proposed_results DB methods"
```

---

### Task 7: Script check-results.ts (GitHub Actions)

**Archivos:**
- Crear: `WorldCup2026/check-results.ts`

**Lógica del script:**

1. Consulta Supabase por partidos cuyo `kickoff_at + 150 minutos < ahora` y `status != 'finished'`
2. Para cada uno, verifica si ya tiene propuesta pendiente (`proposed_results` con `status=pending`)
3. Consulta football-data.org buscando ese partido por fecha/equipos
4. Si está `FINISHED` → extrae scores y llama al worker endpoint `POST /api/admin/propose-result`
5. Si no está `FINISHED` aún → no hace nada

**Importante — mapeo de nombres de equipos:**
football-data.org puede usar nombres distintos a los nuestros (ej. "United States" vs "USA", "Côte d'Ivoire" vs "Ivory Coast"). Crear un mapa de traducción en el script:

```typescript
const TEAM_NAME_MAP: Record<string, string> = {
  'United States': 'USA',
  "Côte d'Ivoire": 'Ivory Coast',
  'Korea Republic': 'South Korea',
  'IR Iran': 'Iran',
  'Türkiye': 'Turkey',
  // Agregar según se detecten diferencias
};
```

**Estructura del script:**

```typescript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN!;
const WORKER_URL = process.env.WORKER_URL!;           // https://oraculobot-worker.carlos-ardila-account.workers.dev
const WORKER_ADMIN_SECRET = process.env.WORKER_ADMIN_SECRET!; // shared secret para autenticar el script

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Partidos que deberían estar terminados pero no tienen resultado
  const cutoff = new Date(Date.now() - 150 * 60 * 1000).toISOString();
  const { data: pending } = await supabase
    .from('matches')
    .select('id, home_team, away_team, kickoff_at, phase')
    .neq('status', 'finished')
    .lt('kickoff_at', cutoff);

  if (!pending?.length) {
    console.log('No hay partidos pendientes de resultado.');
    return;
  }

  // 2. Obtener partidos terminados de football-data.org
  const res = await fetch(
    'https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED&season=2026',
    { headers: { 'X-Auth-Token': FOOTBALL_DATA_TOKEN } }
  );
  if (!res.ok) throw new Error(`football-data.org error: ${res.status}`);
  const { matches: fdMatches } = await res.json() as { matches: FdMatch[] };

  // 3. Para cada partido pendiente nuestro, buscar su match en football-data.org
  for (const match of pending) {
    // Verificar si ya tiene propuesta pendiente
    const { data: existing } = await supabase
      .from('proposed_results')
      .select('id')
      .eq('match_id', match.id)
      .eq('status', 'pending');
    if (existing?.length) {
      console.log(`${match.home_team} vs ${match.away_team}: ya tiene propuesta pendiente`);
      continue;
    }

    const fdMatch = findFdMatch(fdMatches, match);
    if (!fdMatch) {
      console.log(`${match.home_team} vs ${match.away_team}: no encontrado en football-data.org`);
      continue;
    }

    // 4. Enviar propuesta al worker
    await fetch(`${WORKER_URL}/api/admin/propose-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': WORKER_ADMIN_SECRET,
      },
      body: JSON.stringify({ match_id: match.id, fd_match: fdMatch }),
    });

    console.log(`✅ Propuesta enviada: ${match.home_team} vs ${match.away_team}`);
  }
}

function findFdMatch(fdMatches: FdMatch[], our: OurMatch): FdMatch | undefined {
  const ourDate = our.kickoff_at.slice(0, 10); // "2026-06-14"
  return fdMatches.find(fd => {
    const fdDate = fd.utcDate.slice(0, 10);
    if (fdDate !== ourDate) return false;
    const fdHome = TEAM_NAME_MAP[fd.homeTeam.name] ?? fd.homeTeam.name;
    const fdAway = TEAM_NAME_MAP[fd.awayTeam.name] ?? fd.awayTeam.name;
    return fdHome === our.home_team && fdAway === our.away_team;
  });
}

// Tipos para football-data.org v4 response
// Verificar campos exactos en: https://docs.football-data.org/general/v4/match.html
interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
    regularTime: { home: number | null; away: number | null } | null;
    overtime: { home: number | null; away: number | null } | null;
    penalties: { home: number | null; away: number | null } | null;
  };
}

interface OurMatch {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  phase: string;
}

main().catch(err => { console.error(err); process.exit(1); });
```

**⚠️ Nota sobre campos de football-data.org:**
El campo exacto para el marcador a 90 minutos varía según la API. Verificar en la documentación:
- `score.regularTime`: score a los 90 min (disponible cuando hubo ET)
- `score.fullTime`: puede ser el score final incluyendo ET
- `score.overtime`: goles marcados en ET (si aplica)

Cuando `duration = 'REGULAR'`: `fullTime` = score a 90 min.
Cuando `duration = 'EXTRA_TIME'` o `'PENALTY_SHOOTOUT'`: `regularTime` = score a 90 min, `fullTime` = score al final del ET.

**Step: Commit**
```bash
git add WorldCup2026/check-results.ts
git commit -m "feat: add check-results script for football-data.org polling"
```

---

### Task 8: GitHub Actions workflow

**Archivos:**
- Crear: `.github/workflows/check-results.yml`

```yaml
name: Check match results

on:
  schedule:
    - cron: '0,30 * * * *'   # cada 30 min
  workflow_dispatch:

concurrency:
  group: check-results
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Check finished matches
        run: npx tsx WorldCup2026/check-results.ts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          FOOTBALL_DATA_TOKEN: ${{ secrets.FOOTBALL_DATA_TOKEN }}
          WORKER_URL: ${{ secrets.WORKER_URL }}
          WORKER_ADMIN_SECRET: ${{ secrets.WORKER_ADMIN_SECRET }}
```

Agregar los secrets en GitHub:
- `FOOTBALL_DATA_TOKEN` — token de football-data.org
- `WORKER_URL` — URL del worker
- `WORKER_ADMIN_SECRET` — string secreto compartido entre el script y el worker

**Step: Commit**
```bash
git add .github/workflows/check-results.yml
git commit -m "feat: add check-results GitHub Actions cron (every 30min)"
```

---

### Task 9: Endpoint worker POST /api/admin/propose-result

**Archivos:**
- Crear: `worker/src/handlers/web/propose-result.ts`
- Modificar: `worker/src/index.ts` (agregar ruta)
- Modificar: `worker/src/types.ts` (agregar `WORKER_ADMIN_SECRET` a Env)

**Step 1: Agregar WORKER_ADMIN_SECRET al tipo Env en types.ts**
```typescript
WORKER_ADMIN_SECRET: string;
```
Y en `wrangler.toml` agregar el comentario del secret (no el valor).

**Step 2: Crear el handler**

```typescript
// worker/src/handlers/web/propose-result.ts
import type { Env } from '../../types';
import { SupabaseClient } from '../../supabase';
import { sendMenu } from '../../telegram';

interface FdScore {
  winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
  duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
  fullTime: { home: number | null; away: number | null };
  regularTime: { home: number | null; away: number | null } | null;
  overtime: { home: number | null; away: number | null } | null;
  penalties: { home: number | null; away: number | null } | null;
}

interface ProposeResultBody {
  match_id: string;
  fd_match: { score: FdScore; homeTeam: { name: string }; awayTeam: { name: string } };
}

export async function handleProposeResult(request: Request, env: Env): Promise<Response> {
  // Autenticar el script de GitHub Actions
  const secret = request.headers.get('X-Admin-Secret');
  if (secret !== env.WORKER_ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as ProposeResultBody;
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  const match = await db.getMatchById(body.match_id);
  if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
  if (match.status === 'finished') return Response.json({ ok: true, skipped: 'already_finished' });

  // Verificar que no haya ya una propuesta pendiente
  if (await db.hasPendingProposal(body.match_id)) {
    return Response.json({ ok: true, skipped: 'pending_proposal_exists' });
  }

  // Extraer scores desde football-data.org
  const { score } = body.fd_match;
  const isRegular = score.duration === 'REGULAR';
  const isET = score.duration === 'EXTRA_TIME';
  const isPenalties = score.duration === 'PENALTY_SHOOTOUT';

  // Score a 90 minutos (lo que se carga en la polla)
  let home90: number, away90: number;
  if (isRegular) {
    home90 = score.fullTime.home!;
    away90 = score.fullTime.away!;
  } else {
    // Con ET o penales, regularTime tiene el score a 90 min
    home90 = score.regularTime?.home ?? score.fullTime.home!;
    away90 = score.regularTime?.away ?? score.fullTime.away!;
  }

  const homeET = isET || isPenalties ? score.overtime?.home ?? null : null;
  const awayET = isET || isPenalties ? score.overtime?.away ?? null : null;
  const homePen = isPenalties ? score.penalties?.home ?? null : null;
  const awayPen = isPenalties ? score.penalties?.away ?? null : null;
  const penaltyWinner = isPenalties
    ? (score.winner === 'HOME_TEAM' ? 'home' : 'away')
    : null;

  // Guardar propuesta
  const proposal = await db.insertProposedResult({
    match_id: body.match_id,
    home_score_90: home90,
    away_score_90: away90,
    home_score_et: homeET,
    away_score_et: awayET,
    home_penalties: homePen,
    away_penalties: awayPen,
    penalty_winner: penaltyWinner,
    telegram_message_id: null,
  });

  // Construir mensaje Telegram con todos los detalles
  const lines: string[] = [
    `⚽ <b>Resultado disponible (football-data.org)</b>`,
    ``,
    `<b>${match.home_team} vs ${match.away_team}</b>`,
    `🕐 90 min: <code>${home90} - ${away90}</code>`,
  ];
  if (homeET !== null) lines.push(`⏱ ET: <code>${home90 + homeET} - ${away90 + awayET!}</code> (+${homeET}-${awayET!})`);
  if (homePen !== null) lines.push(`🔴 Penales: <code>${homePen} - ${awayPen}</code>`);
  if (penaltyWinner) {
    const winnerName = penaltyWinner === 'home' ? match.home_team : match.away_team;
    lines.push(`🏆 Avanza: <b>${winnerName}</b>`);
  }
  lines.push(``, `¿Aplicar el marcador <code>${home90}-${away90}</code> a los 90 min?`);

  const adminChatId = parseInt(env.ADMIN_TELEGRAM_ID);
  const sentMsg = await sendMenu(
    env.TELEGRAM_BOT_TOKEN,
    adminChatId,
    lines.join('\n'),
    [[
      { text: '✅ Confirmar', callback_data: `admin:propose:confirm:${proposal.id}` },
      { text: '❌ Rechazar', callback_data: `admin:propose:reject:${proposal.id}` },
    ]]
  );

  // Guardar message_id para poder editar después
  if (sentMsg?.message_id) {
    await db.updateProposedResultMessageId(proposal.id, sentMsg.message_id);
  }

  return Response.json({ ok: true, proposal_id: proposal.id });
}
```

**Nota:** `sendMenu` actualmente usa `editMenu` internamente. Verificar si hay un `sendMenuNew` o similar que envíe un mensaje nuevo (no edite). Si no existe, crear una función `sendMenu` que use `sendMessage` con `reply_markup`.

**Step: Commit**
```bash
git add worker/src/handlers/web/propose-result.ts worker/src/types.ts
git commit -m "feat: add propose-result endpoint and Telegram notification"
```

---

### Task 10: Routing del callback Telegram para confirm/reject

**Archivos:**
- Crear: `worker/src/handlers/admin/propose.ts`
- Modificar: `worker/src/router.ts`

**Step 1: Handler de decisión**

```typescript
// worker/src/handlers/admin/propose.ts
import type { Env, DbUser } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { calculatePoints } from '../../services/scoring';
import { triggerSiteBuild } from '../../services/github';
import { propagateBracket } from '../../services/bracket';
import { editMenu, sendMessage } from '../../telegram';

export async function handleProposeDecision(
  decision: 'confirm' | 'reject',
  proposalId: string,
  chatId: number,
  msgId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const proposal = await db.getProposedResult(proposalId);
  if (!proposal) {
    await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
      '⚠️ Esta propuesta ya fue procesada o no existe.',
      []
    );
    return;
  }

  if (decision === 'reject') {
    await db.decideProposedResult(proposalId, 'rejected');
    await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
      '❌ Resultado rechazado. No se aplicaron cambios.',
      []
    );
    return;
  }

  // Confirmar — aplicar resultado (mismo flujo que result.ts)
  const match = await db.getMatchById(proposal.match_id);
  if (!match || match.status === 'finished') {
    await db.decideProposedResult(proposalId, 'rejected');
    await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
      '⚠️ El partido ya tiene resultado cargado.',
      []
    );
    return;
  }

  const { home_score_90: homeScore, away_score_90: awayScore } = proposal;
  await db.finishMatch(proposal.match_id, homeScore, awayScore);

  const predictions = await db.getPredictionsByMatch(proposal.match_id);
  let exactCount = 0, resultCount = 0;
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

  // Manejar ganador en penales si aplica
  if (isKnockout && isDraw && proposal.penalty_winner) {
    await db.setMatchWinner(proposal.match_id, proposal.penalty_winner);
    await propagateBracket(match, proposal.penalty_winner, db).catch(console.error);
  } else if (!isDraw) {
    const winner: 'home' | 'away' = homeScore > awayScore ? 'home' : 'away';
    await db.setMatchWinner(match.id, winner);
    await propagateBracket(match, winner, db).catch(console.error);
  }

  await db.decideProposedResult(proposalId, 'confirmed');

  await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
    `✅ <b>${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}</b> aplicado.\n` +
    `📊 ${predictions.length} predicciones · 🎯 ${exactCount} exacto · ✔️ ${resultCount} correcto\n` +
    `🔄 Regenerando sitio...`,
    []
  );

  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(console.error);
}
```

**Step 2: Agregar al router en router.ts**

```typescript
if (data.startsWith('admin:propose:')) {
  // formato: admin:propose:confirm:<uuid> o admin:propose:reject:<uuid>
  const parts = data.split(':');
  const decision = parts[2] as 'confirm' | 'reject';
  const proposalId = parts[3];
  return handleProposeDecision(decision, proposalId, chatId, msgId, user, db, env);
}
```

**Step: Commit**
```bash
git add worker/src/handlers/admin/propose.ts worker/src/router.ts
git commit -m "feat: add propose confirm/reject Telegram callback handlers"
```

---

### Task 11: Agregar ruta HTTP en index.ts

**Archivos:**
- Modificar: `worker/src/index.ts`

Agregar la ruta `POST /api/admin/propose-result` siguiendo el patrón existente de las rutas web.

**Step: Commit**
```bash
git add worker/src/index.ts
git commit -m "feat: register /api/admin/propose-result route in worker"
```

---

### Task 12: Deploy, prueba y PR Parte 2

**Prueba end-to-end:**

1. Correr el script manualmente apuntando a un partido de prueba:
   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... FOOTBALL_DATA_TOKEN=... \
   WORKER_URL=... WORKER_ADMIN_SECRET=... \
   npx tsx WorldCup2026/check-results.ts
   ```

2. Verificar que llega el mensaje Telegram al admin con todos los detalles

3. Tocar "Confirmar" y verificar en Supabase:
   ```sql
   SELECT status FROM proposed_results ORDER BY proposed_at DESC LIMIT 1;
   SELECT home_score, away_score, status FROM matches WHERE id = '<id>';
   SELECT points FROM predictions WHERE match_id = '<id>' ORDER BY points DESC;
   ```

4. Verificar que el sitio se regeneró

**Step: Commit y PR**
```bash
cd worker && npm run deploy
git push -u origin feature/auto-results
gh pr create --title "feat: auto-results via football-data.org with Telegram approval"
```

---

## Consideraciones de seguridad

- `WORKER_ADMIN_SECRET` debe ser un string aleatorio largo (mínimo 32 chars). Generar con `openssl rand -hex 32`.
- El endpoint `/api/admin/propose-result` valida este secret antes de procesar nada.
- Los callbacks de Telegram para `admin:propose:*` deben verificar que el `user` sea admin (ya lo hace el router existente con `ADMIN_TELEGRAM_ID`).
- Agregar `alter table proposed_results enable row level security;` ya está incluido en la migración.

## Notas finales

- Verificar los campos exactos de football-data.org con un partido real antes del Mundial (usar `workflow_dispatch` para correr el check manualmente cuando haya un partido terminado)
- El TEAM_NAME_MAP debe actualizarse si se encuentran discrepancias de nombres durante los primeros partidos
- La Parte 1 (recalcular) puede mergearse independientemente antes del Mundial
- La Parte 2 idealmente lista antes del 11 de junio de 2026
