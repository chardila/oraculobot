import type { Env, WebQuestionRequest } from '../../types';
import { SupabaseClient } from '../../supabase';
import { authenticate, AuthError } from '../../middleware/auth';
import { askDeepSeek } from '../../services/deepseek';
import { sanitizeUsername } from '../question';

const QUESTIONS_PER_DAY = 10;

export async function handleWebQuestion(request: Request, env: Env): Promise<Response> {
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

  let body: WebQuestionRequest;
  try {
    body = await request.json() as WebQuestionRequest;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.question?.trim()) {
    return Response.json({ error: 'La pregunta no puede estar vacía' }, { status: 400 });
  }
  if (body.question.length > 500) {
    return Response.json({ error: 'La pregunta no puede superar 500 caracteres' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  let questionsToday = user.questions_today;

  if (!user.questions_reset_at || user.questions_reset_at < today) {
    await db.setQuestionsToday(user.id, 0, today);
    questionsToday = 0;
  }

  if (questionsToday >= QUESTIONS_PER_DAY) {
    return Response.json({ error: `Alcanzaste el límite de ${QUESTIONS_PER_DAY} preguntas por día` }, { status: 429 });
  }

  await db.setQuestionsToday(user.id, questionsToday + 1);

  try {
    const [leaderboard, allMatches, recent] = await Promise.all([
      db.getLeaderboard(user.league_id),
      db.getAllMatches(),
      db.getRecentFinished(5),
    ]);

    const leaderboardText = leaderboard.slice(0, 10)
      .map((r, i) => `${i + 1}. ${sanitizeUsername(r.username)}: ${r.total_points} pts`)
      .join('\n');

    const scheduleText = allMatches
      .map(m => {
        const d = new Date(m.kickoff_at).toLocaleString('es-CO', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          timeZone: 'America/Bogota',
        });
        return m.status === 'finished'
          ? `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team} (${d}) [finalizado]`
          : `${m.home_team} vs ${m.away_team} (${d}) [${m.phase}${m.group_name ? ' Grupo ' + m.group_name : ''}]`;
      }).join('\n');

    const recentText = recent
      .map(m => `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`)
      .join('\n');

    const systemPrompt =
      `Eres el asistente del torneo de predicciones del Mundial 2026 de un grupo de amigos.\n` +
      `Responde siempre en español, de forma breve y directa. No uses markdown.\n` +
      `IMPORTANTE: Solo puedes responder preguntas sobre el Mundial 2026 (partidos, equipos, grupos, resultados) y sobre la polla (puntos, predicciones, ranking). Si te preguntan algo diferente, responde exactamente: "Solo puedo responder preguntas sobre el Mundial 2026 y la polla."\n` +
      `Todas las horas son en horario de Colombia (UTC-5). Cuando respondas preguntas sobre horarios de partidos, siempre indica la hora en horario colombiano.\n\n` +
      `CONTEXTO ACTUAL:\n` +
      `Fecha: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n\n` +
      `Leaderboard:\n${leaderboardText || 'Sin puntos aún.'}\n\n` +
      `Calendario completo del Mundial 2026:\n${scheduleText || 'Sin partidos.'}\n\n` +
      `Resultados recientes:\n${recentText || 'Sin resultados aún.'}`;

    const answer = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt, body.question);
    return Response.json({ answer });
  } catch (e) {
    console.error('question web error:', e);
    return Response.json({ error: 'No pude procesar tu pregunta, intenta de nuevo' }, { status: 500 });
  }
}
