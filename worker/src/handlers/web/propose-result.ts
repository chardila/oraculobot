import type { Env } from '../../types';
import { SupabaseClient } from '../../supabase';
import { sendMenu } from '../../telegram';
import { timingSafeEqual } from '../../index';

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
  fd_match: {
    score: FdScore;
    homeTeam: { name: string };
    awayTeam: { name: string };
  };
}

export async function handleProposeResult(request: Request, env: Env): Promise<Response> {
  if (!timingSafeEqual(request.headers.get('X-Admin-Secret'), env.WORKER_ADMIN_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as ProposeResultBody;
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  const match = await db.getMatchById(body.match_id);
  if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
  if (match.status === 'finished') return Response.json({ ok: true, skipped: 'already_finished' });

  if (await db.hasPendingProposal(body.match_id)) {
    return Response.json({ ok: true, skipped: 'pending_proposal_exists' });
  }

  // Extract scores from football-data.org response
  const { score } = body.fd_match;
  const isRegular    = score.duration === 'REGULAR';
  const isET         = score.duration === 'EXTRA_TIME';
  const isPenalties  = score.duration === 'PENALTY_SHOOTOUT';

  // Score at 90 min is what goes into the polla
  const home90 = isRegular
    ? score.fullTime.home!
    : (score.regularTime?.home ?? score.fullTime.home!);
  const away90 = isRegular
    ? score.fullTime.away!
    : (score.regularTime?.away ?? score.fullTime.away!);

  const homeET = (isET || isPenalties) ? (score.overtime?.home ?? null) : null;
  const awayET = (isET || isPenalties) ? (score.overtime?.away ?? null) : null;
  const homePen = isPenalties ? (score.penalties?.home ?? null) : null;
  const awayPen = isPenalties ? (score.penalties?.away ?? null) : null;
  const penaltyWinner = isPenalties
    ? (score.winner === 'HOME_TEAM' ? 'home' : 'away') as 'home' | 'away'
    : null;

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

  // Build Telegram message with all details
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
  await sendMenu(
    env.TELEGRAM_BOT_TOKEN,
    adminChatId,
    lines.join('\n'),
    [[
      { text: '✅ Confirmar', callback_data: `admin:propose:confirm:${proposal.id}` },
      { text: '❌ Rechazar',  callback_data: `admin:propose:reject:${proposal.id}` },
    ]]
  );

  return Response.json({ ok: true, proposal_id: proposal.id });
}
