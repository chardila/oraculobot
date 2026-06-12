import type { Env, WebQuestionRequest } from '../../types';
import { SupabaseClient } from '../../supabase';
import { authenticate, AuthError } from '../../middleware/auth';
import { askDeepSeek } from '../../services/deepseek';
import { sanitizeUsername } from '../../services/sanitize';
import { VENUE_CONTEXT } from '../../services/worldcup-venues';
import { WC_SCHEMA_PROMPT, executeWcQuery } from '../../services/wc-sql';

const QUESTIONS_PER_DAY = 100;

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
    const [leaderboard, allMatches, recent, myPredictions] = await Promise.all([
      db.getLeaderboard(user.league_id),
      db.getAllMatches(),
      db.getRecentFinished(5),
      db.getUserPredictions(user.id),
    ]);

    const leaderboardText = leaderboard.slice(0, 10)
      .map((r, i) => `${i + 1}. ${sanitizeUsername(r.username)}: ${r.total_points} pts`)
      .join('\n');

    const PHASE_LABEL: Record<string, string> = {
      grupos: 'Fase de Grupos',
      treintaidosavos: 'Treintaidosavos de Final',
      octavos: 'Octavos de Final',
      cuartos: 'Cuartos de Final',
      semis: 'Semifinales',
      final: 'Final',
      tercer_lugar: 'Tercer Lugar',
    };
    const phaseLabel = (phase: string) => PHASE_LABEL[phase] ?? phase;

    const scheduleText = allMatches.map(m => {
      const d = new Date(m.kickoff_at).toLocaleString('es-CO', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Bogota',
      });
      const label = `${phaseLabel(m.phase)}${m.group_name ? ' Grupo ' + m.group_name : ''}`;
      return m.status === 'finished'
        ? `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team} (${d}) [${label} - finalizado]`
        : `${m.home_team} vs ${m.away_team} (${d}) [${label}]`;
    }).join('\n');

    const recentText = recent
      .map(m => `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`)
      .join('\n');

    const predByMatchId = new Map(myPredictions.map(p => [p.match_id, p]));
    const myPredictionsText = allMatches.map(m => {
      const d = new Date(m.kickoff_at).toLocaleString('es-CO', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Bogota',
      });
      const phaseInfo = `[${phaseLabel(m.phase)}${m.group_name ? ' Grupo ' + m.group_name : ''}]`;
      const pred = predByMatchId.get(m.id);
      if (!pred) return `${m.home_team} vs ${m.away_team} (${d}) ${phaseInfo}: SIN PREDICCIÓN`;
      const result = m.status === 'finished'
        ? ` | Resultado: ${m.home_score}-${m.away_score} | Puntos: ${pred.points ?? 'pendiente'}`
        : ' | Pendiente';
      return `${m.home_team} vs ${m.away_team} (${d}) ${phaseInfo}: predije ${pred.predicted_home}-${pred.predicted_away}${result}`;
    }).join('\n');

    // ── Primera llamada: clasificar pregunta y/o generar SQL ─────────────────
    const systemPrompt1 =
      `Eres el asistente del torneo de predicciones del Mundial 2026.\n` +
      `Responde siempre en español, de forma breve y directa. No uses markdown.\n` +
      `Solo puedes responder sobre Mundiales de fútbol o la polla. Si te preguntan otra cosa, responde exactamente: "Solo puedo responder preguntas sobre Mundiales de fútbol y la polla."\n\n` +
      `REGLA IMPORTANTE: Si la pregunta es sobre Mundiales de fútbol (historia, partidos, goles, goleadores, grupos, clasificaciones, estadios, eliminatorias, penales, shootout, tarjetas, sustituciones, árbitros, alineaciones, jugadores, técnicos, entrenadores, premios, Golden Boot, Golden Ball, tabla de posiciones, resultados, convocados, nómina, plantel, jugadores de un equipo, porteros, delanteros, clubes representados) O menciona un nombre propio que pueda ser un jugador, técnico o selección del Mundial 2026, responde ÚNICAMENTE con:\n` +
      `SQL: <consulta SQL aquí>\n` +
      `No añadas nada más. El SQL debe usar solo las tablas disponibles.\n\n` +
      `EXCEPCIÓN: Si la pregunta es sobre estadios, ciudades sede, sedes o lugares del Mundial 2026, NO generes SQL. Responde directamente usando la sección "Estadios 2026:" de este prompt.\n\n` +
      `Si la pregunta es sobre la polla (predicciones, puntos, ranking), responde directamente usando el contexto.\n\n` +
      `${WC_SCHEMA_PROMPT}\n\n` +
      `CONTEXTO POLLA:\n` +
      `Fecha: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n` +
      `Usuario: ${sanitizeUsername(user.username)}\n` +
      `Mis predicciones:\n${myPredictionsText}\n\n` +
      `Leaderboard:\n${leaderboardText || 'Sin puntos aún.'}\n\n` +
      `Calendario 2026:\n${scheduleText || 'Sin partidos.'}\n\n` +
      `Resultados recientes:\n${recentText || 'Sin resultados aún.'}\n\n` +
      `Estadios 2026:\n${VENUE_CONTEXT}`;

    const response1 = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt1, body.question, 600);

    // ── Si el modelo generó SQL, ejecutarlo y hacer segunda llamada ──────────
    if (response1.trimStart().toUpperCase().startsWith('SQL:')) {
      const sql = response1.replace(/^SQL:\s*/i, '').trim();
      let { rows, error } = await executeWcQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, sql);

      // Reintentar una vez si hubo error
      if (error) {
        const retry = await askDeepSeek(
          env.DEEPSEEK_API_KEY,
          systemPrompt1,
          `${body.question}\n\n(El SQL anterior falló con error: ${error}. Genera un SQL corregido.)`
        );
        if (retry.trimStart().toUpperCase().startsWith('SQL:')) {
          const retrySql = retry.replace(/^SQL:\s*/i, '').trim();
          ({ rows, error } = await executeWcQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, retrySql));
        }
      }

      if (error || rows.length === 0) {
        const systemPrompt2 =
          `Eres el asistente del torneo de predicciones del Mundial 2026. Responde en español, breve y directo. No uses markdown.\n` +
          `La consulta no devolvió resultados. Informa al usuario que no tienes esa información.`;
        const answer = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt2, body.question);
        await db.insertQuestionLog(user.id, body.question, 'no_data', answer).catch(() => {});
        return Response.json({ answer });
      }

      // Segunda llamada: convertir resultados a respuesta en español
      const resultsText = JSON.stringify(rows, null, 2);
      const systemPrompt2 =
        `Eres el asistente del torneo de predicciones del Mundial 2026. Responde en español, breve y directo. No uses markdown.\n` +
        `El usuario preguntó: "${body.question}"\n` +
        `Los datos de la base de datos son:\n${resultsText}\n` +
        `Responde la pregunta usando solo esos datos.`;

      const answer = await askDeepSeek(env.DEEPSEEK_API_KEY, systemPrompt2, body.question);
      await db.insertQuestionLog(user.id, body.question, 'answered', answer).catch(() => {});
      return Response.json({ answer });
    }

    // ── Respuesta directa (preguntas de polla o fuera de tema) ──────────────
    const outcome = response1.includes('Solo puedo responder') ? 'out_of_scope' : 'answered';
    await db.insertQuestionLog(user.id, body.question, outcome, response1).catch(() => {});
    return Response.json({ answer: response1 });

  } catch (e) {
    console.error('question web error:', e);
    await db.insertQuestionLog(user.id, body.question, 'exception').catch(() => {});
    return Response.json({ error: 'No pude procesar tu pregunta, intenta de nuevo' }, { status: 500 });
  }
}
