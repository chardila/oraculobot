import type { TelegramMessage, Env, DbUser, ConversationState } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { sendMessage, editMenu } from '../../telegram';
import { calculatePoints } from '../../services/scoring';
import { triggerSiteBuild } from '../../services/github';

export async function startAdminResult(
  chatId: number,
  msgId: number,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const matches = await db.getFinishedWithPastKickoff();

  if (matches.length === 0) {
    await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
      '📭 No hay partidos pendientes de resultado.',
      [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
    );
    return;
  }

  const buttons = matches.map(m => ([{
    text: `${m.home_team} vs ${m.away_team}`,
    callback_data: `admin:result:${m.id}`,
  }]));
  buttons.push([{ text: '🔙 Menú', callback_data: 'menu:main' }]);

  await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId,
    '✅ <b>¿Cuál partido quieres cargar?</b>',
    buttons
  );
}

export async function handleAdminResultSelect(
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

  await db.setConversationState(user.telegram_id, 'awaiting_result_score', {
    match_id: match.id,
    home_team: match.home_team,
    away_team: match.away_team,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ <b>${match.home_team} vs ${match.away_team}</b>\n\n` +
    `¿Resultado final? Envía el marcador: <code>local-visitante</code>\n` +
    `Ejemplo: <code>2-1</code>`
  );
}

const SCORE_REGEX = /^(\d{1,2})-(\d{1,2})$/;

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
    await db.clearConversationState(user.telegram_id);
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

  await db.clearConversationState(user.telegram_id);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ <b>${ctx.home_team} ${homeScore} - ${awayScore} ${ctx.away_team}</b>\n\n` +
    `📊 ${predictions.length} predicciones procesadas\n` +
    `🎯 ${exactCount} marcador exacto\n` +
    `✔️ ${resultCount} resultado correcto\n\n` +
    `🔄 Regenerando sitio web...`
  );

  // Fire-and-forget — site regeneration is best-effort
  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(console.error);
}
