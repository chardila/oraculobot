import type { TelegramMessage, TelegramCallbackQuery, Env, DbUser } from '../types';
import type { SupabaseClient } from '../supabase';
import type { ConversationState } from '../types';
import { sendMessage, sendMenu, editMenu } from '../telegram';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Bogota',
  });
}

const CUTOFF_MS = 5 * 60 * 1000;
const WARNING_THRESHOLD_MS = 30 * 60 * 1000;

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

const SCORE_BUTTONS = [
  ['0-0', '1-0', '0-1'],
  ['1-1', '2-0', '0-2'],
  ['2-1', '1-2', '3-0'],
  ['2-2', '3-1', '1-3'],
];

function buildScoreButtons(matchId: string): Array<Array<{ text: string; callback_data: string }>> {
  return SCORE_BUTTONS.map(row =>
    row.map(score => ({
      text: score,
      callback_data: `predict:score:${matchId}:${score}`,
    }))
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

  const cutoff = new Date(match.kickoff_at).getTime() - CUTOFF_MS;
  const msUntilCutoff = cutoff - Date.now();

  if (msUntilCutoff <= 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '⏱ Las predicciones para este partido ya cerraron.');
    return;
  }

  // Check for existing prediction to show user their current pick
  const existing = await db.getPredictionByUserAndMatch(user.id, match.id);

  await db.setConversationState(user.telegram_id, 'awaiting_prediction_score', {
    match_id: match.id,
    home_team: match.home_team,
    away_team: match.away_team,
    kickoff_at: match.kickoff_at,
  });

  let prompt = `🔮 <b>${match.home_team} vs ${match.away_team}</b>\n`;

  if (existing) {
    prompt += `\nTu predicción actual: <b>${match.home_team} ${existing.home_score} - ${existing.away_score} ${match.away_team}</b> ✅\n`;
    prompt += `\n¿Quieres cambiarla? Elige un marcador:`;
  } else {
    if (msUntilCutoff <= WARNING_THRESHOLD_MS) {
      const minutesLeft = Math.floor(msUntilCutoff / 60_000);
      prompt += `\n⚠️ Cierra en ${minutesLeft} minuto${minutesLeft !== 1 ? 's' : ''}\n`;
    }
    prompt += `\n¿Tu predicción? Elige un marcador o escríbelo (ej: <code>2-1</code>):`;
  }

  const buttons = buildScoreButtons(match.id);
  buttons.push([{ text: '🔙 Menú', callback_data: 'menu:main' }]);

  await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId, prompt, buttons);
}

export async function handlePredictionScoreCallback(
  cq: TelegramCallbackQuery,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const data = cq.data ?? '';
  const chatId = cq.message!.chat.id;

  // data format: predict:score:<match_id>:<home>-<away>
  const withoutPrefix = data.replace('predict:score:', '');
  const colonIdx = withoutPrefix.indexOf(':');
  const matchId = withoutPrefix.slice(0, colonIdx);
  const scorePart = withoutPrefix.slice(colonIdx + 1);

  const match = await db.getMatchById(matchId);
  if (!match) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Partido no encontrado.');
    return;
  }

  const cutoff = new Date(match.kickoff_at).getTime() - CUTOFF_MS;
  if (Date.now() >= cutoff) {
    await db.clearConversationState(user.telegram_id);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '⏱ Las predicciones para este partido ya cerraron.');
    return;
  }

  const scoreMatch = SCORE_REGEX.exec(scorePart);
  if (!scoreMatch) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Marcador inválido.');
    return;
  }

  const homeScore = parseInt(scoreMatch[1]);
  const awayScore = parseInt(scoreMatch[2]);

  await db.upsertPrediction({ user_id: user.id, match_id: matchId, home_score: homeScore, away_score: awayScore });
  await db.clearConversationState(user.telegram_id);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ Predicción guardada: <b>${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}</b>`
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
  const cutoff = new Date(ctx.kickoff_at).getTime() - CUTOFF_MS;
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
