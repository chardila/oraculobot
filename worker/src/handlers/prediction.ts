import type { TelegramMessage, TelegramCallbackQuery, Env, DbUser } from '../types';
import type { SupabaseClient } from '../supabase';
import type { ConversationState } from '../types';
import { sendMessage, editMenu } from '../telegram';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Bogota',
  });
}

export async function showPredictionMatches(
  chatId: number,
  msgId: number,
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
    text: `${m.home_team} vs ${m.away_team} — ${formatDate(m.kickoff_at)}`,
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

  if (!data.startsWith('predict:match:')) return;

  const matchId = data.replace('predict:match:', '');
  const match = await db.getMatchById(matchId);

  if (!match) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Partido no encontrado.');
    return;
  }

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
    kickoff_at: match.kickoff_at,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `🔮 <b>${match.home_team} vs ${match.away_team}</b>\n\n` +
    `¿Tu predicción? Envía el marcador como <b>local-visitante</b>\n` +
    `Ejemplo: <code>2-1</code>`
  );
}

const SCORE_REGEX = /^(\d{1,2})-(\d{1,2})$/;

export async function handlePredictionText(
  msg: TelegramMessage,
  state: ConversationState,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? '';
  const ctx = state.context as { match_id: string; home_team: string; away_team: string; kickoff_at: string };

  const scoreMatch = SCORE_REGEX.exec(text);
  if (!scoreMatch) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Formato inválido. Envía el marcador así: <code>2-1</code>');
    return;
  }

  const homeScore = parseInt(scoreMatch[1]);
  const awayScore = parseInt(scoreMatch[2]);

  // Re-check cutoff (user might have taken too long to reply)
  const cutoff = new Date(ctx.kickoff_at).getTime() - 5 * 60 * 1000;
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
