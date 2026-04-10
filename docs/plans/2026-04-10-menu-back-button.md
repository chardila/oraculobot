# Menu Back Button Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "🏠 Menú principal" back button to the "Invitar" and "Pregunta" responses so users can easily return to the main menu.

**Architecture:** "Invitar" edits the original menu message in-place using `editMenu` (consistent with Ranking/Partidos/Predecir). "Pregunta" appends an inline back button to the final answer/error message using `sendMenu`. The existing `menu:main` handler already supports editing a message back to the main menu — no changes needed there.

**Tech Stack:** TypeScript, Cloudflare Workers, Telegram Bot API inline keyboards, Vitest

---

### Task 1: Update `generateInviteCode` to edit menu in-place

**Files:**
- Modify: `worker/src/handlers/admin/invite.ts`
- Modify: `worker/src/handlers/menu.ts`

**Step 1: Update `generateInviteCode` signature and body**

In `worker/src/handlers/admin/invite.ts`, add `msgId: number` as second parameter and replace `sendMessage` with `editMenu`:

```typescript
import type { Env, DbUser } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { editMenu } from '../../telegram';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
}

export async function generateInviteCode(
  chatId: number,
  msgId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const code = generateCode();

  await db.createInviteCode({
    code,
    created_by: user.id,
    max_uses: 1,
  });

  const link = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`;

  await editMenu(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    msgId,
    `🎟 <b>Código de invitación generado:</b>\n\n` +
    `Código: <code>${code}</code>\n` +
    `Link: ${link}\n\n` +
    `(Uso único)`,
    [[{ text: '🏠 Menú principal', callback_data: 'menu:main' }]]
  );
}
```

**Step 2: Pass `msgId` in `menu.ts`**

In `worker/src/handlers/menu.ts`, update the `admin_invite` case (line ~109):

```typescript
case 'admin_invite':
  if (admin) await generateInviteCode(chatId, msgId, user, db, env);
  break;
```

**Step 3: Run tests**

```bash
cd worker && npx vitest run
```
Expected: all tests pass (no existing tests cover invite, so nothing should break)

**Step 4: Commit**

```bash
rtk git add worker/src/handlers/admin/invite.ts worker/src/handlers/menu.ts
rtk git commit -m "feat: edit menu in-place for invite code with back button"
```

---

### Task 2: Add back button to "Pregunta" answer and error messages

**Files:**
- Modify: `worker/src/handlers/question.ts`

**Step 1: Update `handleQuestionText` to use `sendMenu` for final messages**

Replace `sendMessage` imports with `sendMessage, sendMenu` and update the two final sends:

```typescript
import type { TelegramMessage, Env, DbUser, ConversationState } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMessage, sendMenu } from '../telegram';
import { askDeepSeek } from '../services/deepseek';

const BACK_BUTTON = [[{ text: '🏠 Menú principal', callback_data: 'menu:main' }]];

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
  _state: ConversationState,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const question = msg.text?.trim() ?? '';

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⏳ Consultando...');

  try {
    const [leaderboard, allMatches, recent] = await Promise.all([
      db.getLeaderboard(),
      db.getAllMatches(),
      db.getRecentFinished(5),
    ]);

    const leaderboardText = leaderboard.slice(0, 10)
      .map((r, i) => `${i + 1}. ${r.username}: ${r.total_points} pts`)
      .join('\n');

    const scheduleText = allMatches
      .map(m => {
        const d = new Date(m.kickoff_at).toLocaleString('es-CO', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          timeZone: 'America/Bogota',
        });
        if (m.status === 'finished') {
          return `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team} (${d}) [finalizado]`;
        }
        return `${m.home_team} vs ${m.away_team} (${d}) [${m.phase}${m.group_name ? ' Grupo ' + m.group_name : ''}]`;
      }).join('\n');

    const recentText = recent
      .map(m => `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`)
      .join('\n');

    const systemPrompt =
      `Eres el asistente del torneo de predicciones del Mundial 2026 de un grupo de amigos.\n` +
      `Responde siempre en español, de forma breve y directa. No uses markdown.\n` +
      `IMPORTANTE: Solo puedes responder preguntas sobre el Mundial 2026 (partidos, equipos, grupos, resultados) y sobre la polla (puntos, predicciones, ranking). Si te preguntan algo diferente, responde exactamente: "Solo puedo responder preguntas sobre el Mundial 2026 y la polla."\n` +
      `Todas las horas son en horario de Colombia (UTC-5). Cuando respondas preguntas sobre horarios de partidos, siempre indica la hora en horario colombiano.\n\n` +
      `CONTEXTO ACTUAL:\n` +
      `Fecha: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n\n` +
      `Leaderboard:\n${leaderboardText || 'Sin puntos aún.'}\n\n` +
      `Calendario completo del Mundial 2026:\n${scheduleText || 'Sin partidos.'}\n\n` +
      `Resultados recientes:\n${recentText || 'Sin resultados aún.'}`;

    const answer = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt, question);
    await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId, answer, BACK_BUTTON);
  } catch (e) {
    console.error('question handler error:', e);
    await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
      'No pude procesar tu pregunta en este momento, intenta de nuevo.',
      BACK_BUTTON);
  } finally {
    await db.clearConversationState(user.telegram_id);
  }
}
```

**Step 2: Run tests**

```bash
cd worker && npx vitest run
```
Expected: all tests pass

**Step 3: Commit**

```bash
rtk git add worker/src/handlers/question.ts
rtk git commit -m "feat: add back-to-menu button to question answer"
```
