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

  const ranking = await db.getLeaderboard(user.league_id);
  return Response.json(ranking);
}
