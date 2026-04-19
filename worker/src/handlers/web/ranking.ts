import type { Env } from '../../types';
import { SupabaseClient } from '../../supabase';

export async function handleWebRanking(_request: Request, env: Env): Promise<Response> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const ranking = await db.getLeaderboard();
  return Response.json(ranking);
}
