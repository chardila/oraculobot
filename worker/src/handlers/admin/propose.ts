import type { Env, DbUser } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { calculatePoints } from '../../services/scoring';
import { triggerSiteBuild } from '../../services/github';
import { propagateBracket } from '../../services/bracket';
import { sendMessage, editMenu } from '../../telegram';

export async function handleProposeDecision(
  decision: 'confirm' | 'reject',
  proposalId: string,
  chatId: number,
  msgId: number,
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

  try {
    await triggerSiteBuild(env.GITHUB_PAT, env.GITHUB_REPO);
  } catch (err) {
    console.error(err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '⚠️ Error al regenerar el sitio web. Disparalo manualmente en GitHub Actions.');
  }
}
