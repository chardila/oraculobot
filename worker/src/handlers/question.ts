import type { TelegramMessage, Env, DbUser, ConversationState } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMessage, sendMenu } from '../telegram';
import { askDeepSeek } from '../services/deepseek';
import { VENUE_CONTEXT } from '../services/worldcup-venues';

const BACK_BUTTON = [[{ text: '🔙 Menú', callback_data: 'menu:main' }]];

export function sanitizeUsername(name: string | null | undefined): string {
  if (!name) return 'Anónimo';
  return name.replace(/[\r\n\t]/g, ' ').slice(0, 30);
}

export async function startQuestion(
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  await db.setConversationState(user.telegram_id!, 'awaiting_question', {});
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    '❓ Escribe tu pregunta sobre el torneo, los partidos o los resultados.\n\n' +
    'Cuando termines, toca el botón <b>🔙 Menú</b> en cualquier respuesta (o escribe /cancel).',
    true);
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

  if (!question) {
    await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
      'La pregunta no puede estar vacía.', BACK_BUTTON);
    return;
  }

  if (question.length > 500) {
    await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
      'La pregunta no puede superar 500 caracteres.', BACK_BUTTON);
    return;
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⏳ Consultando...');

  try {
    const [leaderboard, allMatches, recent] = await Promise.all([
      db.getLeaderboard(),
      db.getAllMatches(),
      db.getRecentFinished(5),
    ]);

    const leaderboardText = leaderboard.slice(0, 10)
      .map((r, i) => `${i + 1}. ${sanitizeUsername(r.username)}: ${r.total_points} pts`)
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
      `REGLAS ESTRICTAS:\n` +
      `1. Solo responde preguntas sobre el Mundial 2026 (partidos, equipos, grupos, resultados, estadios, ciudades sede) y sobre la polla (puntos, predicciones, ranking). Si te preguntan algo diferente, responde exactamente: "Solo puedo responder preguntas sobre el Mundial 2026 y la polla."\n` +
      `2. Usa ÚNICAMENTE la información del contexto que se te proporciona a continuación. NO uses conocimiento propio ni inventes datos.\n` +
      `3. Si la respuesta no está en el contexto, responde exactamente: "No tengo esa información en el contexto disponible."\n` +
      `4. Nunca asumas ni extrapoles datos que no aparezcan explícitamente en el contexto.\n` +
      `Todas las horas son en horario de Colombia (UTC-5). Cuando respondas preguntas sobre horarios de partidos, siempre indica la hora en horario colombiano.\n\n` +
      `CONTEXTO ACTUAL:\n` +
      `Fecha: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n\n` +
      `${VENUE_CONTEXT}\n\n` +
      `Leaderboard:\n${leaderboardText || 'Sin puntos aún.'}\n\n` +
      `Calendario completo del Mundial 2026:\n${scheduleText || 'Sin partidos.'}\n\n` +
      `Resultados recientes:\n${recentText || 'Sin resultados aún.'}`;

    const answer = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt, question);
    await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId, answer, BACK_BUTTON);
  } catch (e) {
    console.error('question handler error:', e);
    await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
      'No pude procesar tu pregunta en este momento, intenta de nuevo.', BACK_BUTTON);
  }
  // State stays as awaiting_question — user can ask follow-up questions.
  // Cleared when user taps "🔙 Menú" (menu:main handler).
}
