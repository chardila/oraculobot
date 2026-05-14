import type { Env } from '../../types';
import { SupabaseClient } from '../../supabase';
import { authenticate, AuthError } from '../../middleware/auth';

export async function handleWebRanking(request: Request, env: Env): Promise<Response> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  let user;
  try {
    user = await authenticate(request, env, db);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const [rankingRaw, leagues] = await Promise.all([
    db.getLeaderboard(user.league_id),
    db.getLeagues(),
  ]);
  const adminId = env.ADMIN_TELEGRAM_ID ? Number(env.ADMIN_TELEGRAM_ID) : null;
  const ranking = adminId
    ? rankingRaw.filter(r => r.telegram_id !== adminId)
    : rankingRaw;
  const league = leagues.find(l => l.id === user.league_id);
  return Response.json({ league_name: league?.name ?? null, ranking });
}
