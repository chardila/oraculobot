import type { Env } from '../../types';
import { SupabaseClient } from '../../supabase';

export async function handleWebMatches(_request: Request, env: Env): Promise<Response> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const matches = await db.getAllMatches();
  return Response.json(matches);
}
