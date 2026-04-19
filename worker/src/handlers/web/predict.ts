import type { Env, WebPredictRequest } from '../../types';
import { SupabaseClient } from '../../supabase';
import { authenticate, AuthError } from '../../middleware/auth';

const CUTOFF_MS = 5 * 60 * 1000;

export async function handleWebPredict(request: Request, env: Env): Promise<Response> {
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

  let body: WebPredictRequest;
  try {
    body = await request.json() as WebPredictRequest;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { match_id, home_score, away_score } = body;
  if (!match_id || home_score == null || away_score == null) {
    return Response.json({ error: 'match_id, home_score y away_score son requeridos' }, { status: 400 });
  }

  if (!Number.isInteger(home_score) || !Number.isInteger(away_score) || home_score < 0 || away_score < 0) {
    return Response.json({ error: 'Los marcadores deben ser números enteros no negativos' }, { status: 400 });
  }

  const match = await db.getMatchById(match_id);
  if (!match) {
    return Response.json({ error: 'Partido no encontrado' }, { status: 404 });
  }

  if (match.status === 'finished') {
    return Response.json({ error: 'Este partido ya finalizó' }, { status: 400 });
  }

  const kickoff = new Date(match.kickoff_at).getTime();
  if (Date.now() > kickoff - CUTOFF_MS) {
    return Response.json({ error: 'Las predicciones para este partido ya cerraron' }, { status: 400 });
  }

  await db.upsertPrediction({ user_id: user.id, match_id, home_score, away_score });
  return Response.json({ ok: true });
}
