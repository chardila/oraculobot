import type { TelegramMessage, Env, DbUser, ConversationState } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { sendMessage, sendMenu, editMenu } from '../../telegram';
import { calculatePoints } from '../../services/scoring';
import { triggerSiteBuild } from '../../services/github';
import { propagateBracket } from '../../services/bracket';

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

  await db.setConversationState(user.telegram_id!, 'awaiting_result_score', {
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
    await db.clearConversationState(user.telegram_id!);
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

  const isDraw = homeScore === awayScore;
  const isKnockout = match.phase !== 'grupos';

  if (isKnockout && isDraw) {
    await db.setConversationState(user.telegram_id!, 'awaiting_penalty_winner', {
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      match_num: match.match_num,
    });
    await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
      `✅ <b>${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}</b>\n\n` +
      `📊 ${predictions.length} predicciones procesadas\n` +
      `🎯 ${exactCount} marcador exacto · ✔️ ${resultCount} resultado correcto\n\n` +
      `⚽ Empate en 90 min. ¿Quién avanzó en penales?`,
      [[
        { text: `🏠 ${match.home_team}`, callback_data: 'admin:penalty:home' },
        { text: `✈️ ${match.away_team}`, callback_data: 'admin:penalty:away' },
      ]]
    );
    return;
  }

  const winner: 'home' | 'away' = homeScore > awayScore ? 'home' : 'away';
  await db.setMatchWinner(match.id, winner);
  await propagateBracket(match, winner, db).catch(console.error);

  await db.clearConversationState(user.telegram_id!);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ <b>${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}</b>\n\n` +
    `📊 ${predictions.length} predicciones procesadas\n` +
    `🎯 ${exactCount} marcador exacto · ✔️ ${resultCount} resultado correcto\n\n` +
    `🔄 Regenerando sitio web...`
  );

  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(console.error);
}

export async function handleAdminPenaltyWinner(
  winner: 'home' | 'away',
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const state = await db.getConversationState(user.telegram_id!);
  if (!state || state.step !== 'awaiting_penalty_winner') return;

  const ctx = state.context as {
    match_id: string;
    home_team: string;
    away_team: string;
    match_num: number | null;
  };

  await db.setMatchWinner(ctx.match_id, winner);
  await propagateBracket(ctx, winner, db).catch(console.error);
  await db.clearConversationState(user.telegram_id!);

  const winnerName = winner === 'home' ? ctx.home_team : ctx.away_team;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `🏆 <b>${winnerName}</b> avanzó en penales.\n\n🔄 Regenerando sitio web...`
  );

  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(console.error);
}
