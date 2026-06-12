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

  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(async (err) => {
    console.error(err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '⚠️ Error al regenerar el sitio web. Disparalo manualmente en GitHub Actions.');
  });
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
  triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO).catch(async (err) => {
    console.error(err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '⚠️ Error al regenerar el sitio web. Disparalo manualmente en GitHub Actions.');
  });
}
