import type { Env, ReminderMatch } from '../../types';
import { SupabaseClient } from '../../supabase';
import { authenticate, AuthError } from '../../middleware/auth';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function filterUnpredicted(
  matches: ReminderMatch[],
  predictedIds: Set<string>,
  now: Date,
  windowMs = WINDOW_MS
): ReminderMatch[] {
  const cutoff = new Date(now.getTime() + windowMs);
  return matches.filter(m => {
    const kickoff = new Date(m.kickoff_at);
    return kickoff > now && kickoff <= cutoff && !predictedIds.has(m.id);
  });
}

export async function handleWebReminders(request: Request, env: Env): Promise<Response> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  let user;
  try {
    user = await authenticate(request, env, db);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const now = new Date();

  const [upcomingMatches, predictions] = await Promise.all([
    db.req<ReminderMatch[]>('matches', {}, {
      status: 'eq.scheduled',
      kickoff_at: `gt.${now.toISOString()}`,
      select: 'id,home_team,away_team,kickoff_at',
      order: 'kickoff_at.asc',
      limit: '50',
    }),
    db.req<{ match_id: string }[]>('predictions', {}, {
      user_id: `eq.${user.id}`,
      select: 'match_id',
    }),
  ]);

  const predictedIds = new Set(predictions.map(p => p.match_id));
  const reminders = filterUnpredicted(upcomingMatches, predictedIds, now);

  return Response.json(reminders);
}
