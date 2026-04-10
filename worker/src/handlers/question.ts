import type { TelegramMessage, Env, DbUser, ConversationState } from '../types';
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
  _state: ConversationState,
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

    const systemPrompt =
      `Eres el asistente del torneo de predicciones del Mundial 2026 de un grupo de amigos.\n` +
      `Responde siempre en español, de forma breve y directa. No uses markdown.\n\n` +
      `CONTEXTO ACTUAL:\n` +
      `Fecha: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n\n` +
      `Leaderboard:\n${leaderboardText || 'Sin puntos aún.'}\n\n` +
      `Próximos partidos:\n${upcomingText || 'Sin partidos próximos.'}\n\n` +
      `Resultados recientes:\n${recentText || 'Sin resultados aún.'}`;

    const answer = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt, question);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, answer);
  } catch {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      'No pude procesar tu pregunta en este momento, intenta de nuevo.');
  } finally {
    await db.clearConversationState(user.telegram_id);
  }
}
