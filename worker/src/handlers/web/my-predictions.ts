import type { Env } from '../../types';
import { SupabaseClient } from '../../supabase';
import { authenticate, AuthError } from '../../middleware/auth';
import { calculatePointsBreakdown } from '../../services/scoring';

export async function handleWebMyPredictions(request: Request, env: Env): Promise<Response> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  let user;
  try {
    user = await authenticate(request, env, db);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const predictions = await db.getUserPredictions(user.id);
  const enriched = predictions.map(p => {
    if (p.status === 'finished' && p.actual_home !== null && p.actual_away !== null && p.phase !== 'grupos') {
      return {
        ...p,
        breakdown: calculatePointsBreakdown(
          { home: p.predicted_home, away: p.predicted_away },
          { home: p.actual_home, away: p.actual_away },
          p.phase
        ),
      };
    }
    return p;
  });
  return Response.json({ predictions: enriched });
}
