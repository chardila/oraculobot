// worker/src/services/wc-sql.ts

const ALLOWED_TABLES = [
  'wc_matches', 'wc_goals', 'wc_teams', 'wc_stadiums',
  'wc_referees', 'wc_referee_appearances',
  'wc_bookings', 'wc_substitutions', 'wc_player_appearances',
  'wc_penalty_kicks', 'wc_group_standings', 'wc_award_winners',
  'wc_squads_2026',
  'wc_coaches_2026',
  'wc_standings_2026',
  'matches',
];

export const WC_SCHEMA_PROMPT = `
Tienes acceso a las siguientes tablas de base de datos con historia de Mundiales de Fútbol:

wc_matches(id, year, tournament, phase, home_team, away_team, home_score, away_score, home_ht, away_ht, match_date, ground, extra_time, penalty_shootout, home_penalties, away_penalties)
  - year: número entero (1930, 1934, ..., 2022)
  - tournament: 'FIFA World Cup' o 'FIFA World Cup qualification'
  - phase valores exactos (usar siempre estos): 'Group A'..'Group H', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final', 'Third-place match'. Históricos: 'First round', 'Final Round', 'Preliminary round'.
  - IMPORTANTE: home_score/away_score es el marcador al final de los 90 minutos, NO incluye goles de prórroga. Para el resultado completo de partidos con extra_time=true, contar goles desde wc_goals.
  - extra_time: true si el partido fue a prórroga
  - penalty_shootout: true si hubo penales; home_penalties/away_penalties tienen los goles de shootout (no están en home_score/away_score)
  - ground: formato "Nombre Estadio, Ciudad". Para extraer ciudad: SPLIT_PART(ground, ', ', 2). Para el país sede usar: CASE year WHEN 1930 THEN 'Uruguay' WHEN 1934 THEN 'Italy' WHEN 1938 THEN 'France' WHEN 1950 THEN 'Brazil' WHEN 1954 THEN 'Switzerland' WHEN 1958 THEN 'Sweden' WHEN 1962 THEN 'Chile' WHEN 1966 THEN 'England' WHEN 1970 THEN 'Mexico' WHEN 1974 THEN 'West Germany' WHEN 1978 THEN 'Argentina' WHEN 1982 THEN 'Spain' WHEN 1986 THEN 'Mexico' WHEN 1990 THEN 'Italy' WHEN 1994 THEN 'United States' WHEN 1998 THEN 'France' WHEN 2002 THEN 'Japan/South Korea' WHEN 2006 THEN 'Germany' WHEN 2010 THEN 'South Africa' WHEN 2014 THEN 'Brazil' WHEN 2018 THEN 'Russia' WHEN 2022 THEN 'Qatar' END

wc_goals(id, match_id, team, scorer, minute, minute_stoppage, match_period, penalty, own_goal)
  - match_id: referencia a wc_matches.id
  - match_period: 'first half', 'second half', 'extra time first half', 'extra time second half'

wc_teams(id, year, name, fifa_code, continent, confederation, group_name)
  - confederation: 'UEFA', 'CONMEBOL', 'CONCACAF', 'CAF', 'AFC', 'OFC'
  - Solo disponible para años con datos (2014, 2018)

wc_stadiums(id, year, name, city, country, capacity)
  - Solo disponible para años con datos (2014, 2018, 2022)

wc_bookings(id, match_id, team, player_name, shirt_number, minute_regulation, minute_stoppage, match_period, yellow_card, red_card, second_yellow_card)
  - Tarjetas desde 1970. match_id referencia wc_matches.id

wc_substitutions(id, match_id, team, player_name, shirt_number, minute_regulation, minute_stoppage, match_period, going_off, coming_on)
  - Sustituciones desde 1970. IMPORTANTE: cada sustitución genera DOS filas — una con going_off=true (jugador que sale) y otra con coming_on=true (jugador que entra). Para contar sustituciones usa WHERE going_off = true. Para listar jugadores que entraron usa WHERE coming_on = true.

wc_player_appearances(id, match_id, team, player_name, shirt_number, position_name, position_code, starter, substitute)
  - Apariciones por partido. position_code: 'GK', 'DF', 'MF', 'FW'
  - IMPORTANTE: datos completos solo desde 1970. Para jugadores pre-1970 (ej. Pelé, Eusébio), NO uses esta tabla para contar mundiales — usa wc_goals con el nombre del jugador en su lugar (ver ejemplo abajo).

wc_penalty_kicks(id, match_id, team, player_name, shirt_number, converted)
  - SOLO penales en tanda de shootout (definición por penales), desde 1982. converted=true si marcó.
  - NUNCA usar esta tabla para penales cometidos durante el partido — esos están en wc_goals con penalty=true.

wc_group_standings(id, year, group_name, position, team, played, wins, draws, losses, goals_for, goals_against, goal_difference, points, advanced)
  - Tabla de posiciones de fase de grupos, todos los años

wc_award_winners(id, year, award_name, player_name, team, shared)
  - Premios individuales: 'Golden Boot', 'Golden Ball', 'Best Young Player', 'Golden Glove'

wc_referees(id, jfjelstul_referee_id, family_name, given_name, country_name, confederation_code)

wc_referee_appearances(id, match_id, referee_id, family_name, given_name, country_name)

Ejemplos de consultas:
- Goles de Messi en 2022: SELECT scorer, COUNT(*) as goles FROM wc_goals g JOIN wc_matches m ON g.match_id = m.id WHERE m.year = 2022 AND m.tournament = 'FIFA World Cup' AND g.scorer ILIKE '%Messi%' GROUP BY scorer
- Resultado final 2018 (sin prórroga): SELECT home_team, home_score, away_score, away_team FROM wc_matches WHERE year = 2018 AND phase = 'Final'
- Resultado completo final 2022 (con prórroga y penales): SELECT m.home_team, COUNT(*) FILTER (WHERE g.team = m.home_team) as home_goals, COUNT(*) FILTER (WHERE g.team = m.away_team) as away_goals, m.away_team, m.home_penalties, m.away_penalties FROM wc_matches m JOIN wc_goals g ON g.match_id = m.id WHERE m.year = 2022 AND m.phase = 'Final' GROUP BY m.id, m.home_team, m.away_team, m.home_penalties, m.away_penalties
- Tarjetas de un jugador: SELECT m.year, m.home_team, m.away_team, b.yellow_card, b.red_card FROM wc_bookings b JOIN wc_matches m ON b.match_id = m.id WHERE b.player_name ILIKE '%Ramos%' ORDER BY m.year
- Tabla del Grupo A 2014: SELECT position, team, played, wins, draws, losses, goals_for, goals_against, points FROM wc_group_standings WHERE year = 2014 AND group_name = 'Group A' ORDER BY position
- Ganadores del Golden Boot: SELECT year, player_name, team FROM wc_award_winners WHERE award_name = 'Golden Boot' ORDER BY year DESC
- Penales en la tanda shootout de la final 2022: SELECT team, player_name, converted FROM wc_penalty_kicks pk JOIN wc_matches m ON pk.match_id = m.id WHERE m.year = 2022 AND m.phase = 'Final' ORDER BY team
- Penales convertidos por Messi en juego en 2022 (NO shootout): SELECT COUNT(*) FROM wc_goals g JOIN wc_matches m ON g.match_id = m.id WHERE m.year = 2022 AND m.tournament = 'FIFA World Cup' AND g.scorer ILIKE '%Messi%' AND g.penalty = true
- Partidos de Colombia en eliminatorias: SELECT match_date, home_team, home_score, away_score, away_team FROM wc_matches WHERE year = 2026 AND tournament = 'FIFA World Cup qualification' AND (home_team = 'Colombia' OR away_team = 'Colombia') ORDER BY match_date
- Árbitro con más partidos dirigidos: SELECT family_name, given_name, country_name, COUNT(*) as partidos FROM wc_referee_appearances GROUP BY family_name, given_name, country_name ORDER BY partidos DESC LIMIT 5
- Árbitros de la final 2022: SELECT family_name, given_name, country_name FROM wc_referee_appearances ra JOIN wc_matches m ON ra.match_id = m.id WHERE m.year = 2022 AND m.phase = 'Final'
- En cuántos mundiales jugó Pelé (jugador pre-1970: usar wc_goals, no wc_player_appearances): SELECT COUNT(DISTINCT m.year) as mundiales FROM wc_goals g JOIN wc_matches m ON g.match_id = m.id WHERE m.tournament = 'FIFA World Cup' AND g.scorer ILIKE '%Pelé%' AND g.own_goal = false
- Goles de Maradona en mundiales: SELECT m.year, COUNT(*) as goles FROM wc_goals g JOIN wc_matches m ON g.match_id = m.id WHERE m.tournament = 'FIFA World Cup' AND g.scorer ILIKE '%Maradona%' AND g.own_goal = false GROUP BY m.year ORDER BY m.year
- Goleador del Mundial 1958: SELECT scorer, COUNT(*) as goles FROM wc_goals g JOIN wc_matches m ON g.match_id = m.id WHERE m.year = 1958 AND m.tournament = 'FIFA World Cup' AND g.own_goal = false GROUP BY scorer ORDER BY goles DESC LIMIT 5
- Cuántas veces se enfrentaron Brasil y Argentina: SELECT COUNT(*) as partidos FROM wc_matches WHERE tournament = 'FIFA World Cup' AND ((home_team = 'Brazil' AND away_team = 'Argentina') OR (home_team = 'Argentina' AND away_team = 'Brazil'))
- Ciudad y país de la final 2018: SELECT ground, SPLIT_PART(ground, ', ', 2) as ciudad, CASE year WHEN 2018 THEN 'Russia' END as pais FROM wc_matches WHERE year = 2018 AND phase = 'Final'
- País donde se jugaron los partidos de Argentina en 2014: SELECT DISTINCT CASE year WHEN 2014 THEN 'Brazil' END as pais, SPLIT_PART(ground, ', ', 2) as ciudad, ground FROM wc_matches WHERE year = 2014 AND tournament = 'FIFA World Cup' AND (home_team = 'Argentina' OR away_team = 'Argentina') ORDER BY ciudad

wc_squads_2026(id, team, jersey_number, player_name, position, born, age_at_tournament, club_name, club_country, goals, captain, preliminary)
  - team: nombre exacto como en la tabla matches (ej. 'Colombia', 'USA', 'South Korea', 'Bosnia & Herzegovina', 'Ivory Coast')
  - position: 'GK', 'DF', 'MF', 'FW'
  - captain: true si es el capitán del equipo
  - preliminary: true si es lista preliminar aún no cortada al squad final de 26; false si es la convocatoria final
  - jersey_number: null hasta que la FIFA asigne dorsales (~días antes del torneo)
  - Sin datos aún: Australia, Ecuador, Uruguay, Algeria

Ejemplos:
- Convocados de Colombia: SELECT player_name, position, club_name, club_country FROM wc_squads_2026 WHERE team = 'Colombia' ORDER BY position, player_name
- Porteros de España: SELECT player_name, club_name FROM wc_squads_2026 WHERE team = 'Spain' AND position = 'GK'
- Jugadores del Real Madrid en el Mundial: SELECT team, player_name, position FROM wc_squads_2026 WHERE club_name ILIKE '%Real Madrid%' ORDER BY team
- Club con más jugadores en el Mundial: SELECT club_name, club_country, COUNT(*) as jugadores FROM wc_squads_2026 WHERE preliminary = false GROUP BY club_name, club_country ORDER BY jugadores DESC LIMIT 10
- Jugadores más jóvenes del torneo: SELECT player_name, team, born, age_at_tournament FROM wc_squads_2026 WHERE born IS NOT NULL AND preliminary = false ORDER BY born DESC LIMIT 10
- Equipos con convocatoria confirmada: SELECT DISTINCT team FROM wc_squads_2026 WHERE preliminary = false ORDER BY team
- Jugadores que juegan fuera de su país (equipos con convocatoria final de 26): WITH sz AS (SELECT team, COUNT(*) as total FROM wc_squads_2026 GROUP BY team) SELECT s.team, COUNT(*) AS en_exterior FROM wc_squads_2026 s JOIN sz ON s.team = sz.team WHERE sz.total = 26 AND s.club_country IS NOT NULL AND s.club_country != '' AND s.club_country != CASE WHEN s.team = 'USA' THEN 'United States' ELSE s.team END GROUP BY s.team ORDER BY en_exterior DESC LIMIT 10
  NOTAS IMPORTANTES sobre wc_squads_2026: (1) Algunos equipos tienen listas preliminares extendidas (>26 jugadores) no marcadas como preliminary — filtrar siempre con sz.total = 26 en preguntas de comparación entre equipos. (2) club_country usa 'United States' para USA; usar CASE WHEN team='USA' THEN 'United States' ELSE team END. (3) Las columnas son club_country y team, NUNCA 'country'.

wc_coaches_2026(id, team, fifa_code, confederation, group_name, coach_name, coach_country, squad_kind)
  - team: nombre exacto como en matches (ej. 'Colombia', 'USA', 'Bosnia & Herzegovina')
  - confederation: 'UEFA', 'CONMEBOL', 'CONCACAF', 'CAF', 'AFC', 'OFC'
  - group_name: 'A' .. 'L' (12 grupos en 2026)
  - squad_kind: 'final' si la convocatoria está cerrada, 'preliminary' si aún es lista extendida
  - 48 equipos del Mundial 2026 con su técnico y grupo

Ejemplos:
- Técnico de Colombia: SELECT coach_name, coach_country FROM wc_coaches_2026 WHERE team = 'Colombia'
- Técnicos extranjeros en el Mundial: SELECT team, coach_name, coach_country FROM wc_coaches_2026 WHERE coach_country != team ORDER BY coach_country
  NOTA: Para USA usar: WHERE coach_country NOT IN ('United States') AND team = 'USA' — coach_country usa nombre completo de país
- Equipos del Grupo B: SELECT team, coach_name FROM wc_coaches_2026 WHERE group_name = 'B' ORDER BY team
- Cuántos técnicos europeos hay: SELECT coach_country, COUNT(*) as equipos FROM wc_coaches_2026 WHERE coach_country IS NOT NULL GROUP BY coach_country ORDER BY equipos DESC
- Equipos con convocatoria final por confederación: SELECT confederation, COUNT(*) as equipos FROM wc_coaches_2026 WHERE squad_kind = 'final' GROUP BY confederation ORDER BY equipos DESC

wc_standings_2026(group_name, position, team, played, wins, draws, losses, goals_for, goals_against, goal_difference, points, updated_at)
  - group_name: 'A'..'L' (12 grupos en el Mundial 2026)
  - position: 1..4 dentro del grupo
  - team: nombre exacto como en la tabla matches (ej. 'Colombia', 'USA', 'Bosnia & Herzegovina')
  - updated_at: cuándo se sincronizó por última vez desde football-data.org

Ejemplos:
- Tabla del Grupo A: SELECT position, team, played, wins, draws, losses, goals_for, goals_against, points FROM wc_standings_2026 WHERE group_name = 'A' ORDER BY position
- Cómo va Colombia en el grupo: SELECT group_name, position, points, played, wins, draws, losses FROM wc_standings_2026 WHERE team = 'Colombia'
- Top 2 de cada grupo (clasificados directos): SELECT group_name, position, team, points FROM wc_standings_2026 WHERE position <= 2 ORDER BY group_name, position
- Grupos donde todos han jugado al menos 1 partido: SELECT group_name, MIN(played) as min_played FROM wc_standings_2026 GROUP BY group_name HAVING MIN(played) >= 1 ORDER BY group_name

matches(id, home_team, away_team, kickoff_at, phase, group_name, home_score, away_score, status, ground, match_num, winner, referee)
  - Partidos del Mundial 2026 (los 104 partidos del torneo)
  - status: 'scheduled' (pendiente) | 'finished' (finalizado)
  - phase: 'grupos' | 'treintaidosavos' | 'octavos' | 'cuartos' | 'semis' | 'final' | 'tercer_lugar'
  - group_name: 'A'..'L' en fase de grupos, null en eliminatorias
  - home_score/away_score: goles a los 90 min, null si aún no hay resultado
  - winner: 'home' | 'away' | null (solo en eliminatorias, incluye resultado de penales)
  - referee: árbitro principal asignado por FIFA (null si aún no asignado)
  - ground: clave de sede — cruzar con contexto "Estadios 2026:" para obtener nombre y ciudad
  - kickoff_at: hora UTC del partido
  - Todos los equipos usan el mismo nombre que en wc_squads_2026 y wc_coaches_2026

Ejemplos:
- Árbitro del partido de hoy: SELECT home_team, away_team, referee FROM matches WHERE DATE(kickoff_at) = CURRENT_DATE AND referee IS NOT NULL
- Árbitros de todos los partidos de hoy: SELECT home_team, away_team, kickoff_at, referee FROM matches WHERE DATE(kickoff_at) = CURRENT_DATE ORDER BY kickoff_at
- Partidos de Colombia en el Mundial 2026: SELECT home_team, away_team, kickoff_at, home_score, away_score, status FROM matches WHERE home_team = 'Colombia' OR away_team = 'Colombia' ORDER BY kickoff_at
- Próximos partidos sin resultado: SELECT home_team, away_team, kickoff_at FROM matches WHERE status = 'scheduled' ORDER BY kickoff_at LIMIT 5
`.trim();

export function validateWcSql(sql: string): { valid: boolean; error?: string } {
  const trimmed = sql.trim().toLowerCase();

  if (!trimmed.startsWith('select') && !trimmed.startsWith('with')) {
    return { valid: false, error: 'Query must start with SELECT or WITH' };
  }

  const forbidden = /\b(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|pg_)\b/;
  if (forbidden.test(trimmed)) {
    return { valid: false, error: 'Query contains forbidden keywords' };
  }

  // Collect CTE alias names so they can be referenced in FROM/JOIN without failing
  const cteNames = new Set<string>();
  const cteMatches = trimmed.matchAll(/\b(\w+)\s+as\s*\(/gi);
  for (const m of cteMatches) cteNames.add(m[1].toLowerCase());

  // Check all referenced table names are in the allowed list
  const tableRefs = trimmed.match(/\bfrom\s+(\w+)|\bjoin\s+(\w+)/gi) ?? [];
  for (const ref of tableRefs) {
    const table = ref.replace(/\b(from|join)\s+/i, '').trim();
    if (cteNames.has(table)) continue;
    if (!ALLOWED_TABLES.includes(table)) {
      return { valid: false, error: `Table "${table}" is not allowed` };
    }
  }

  return { valid: true };
}

export async function executeWcQuery(
  supabaseUrl: string,
  serviceKey: string,
  sql: string
): Promise<{ rows: unknown[]; error?: string }> {
  const validation = validateWcSql(sql);
  if (!validation.valid) {
    return { rows: [], error: validation.error };
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_wc_query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { rows: [], error: `DB error: ${text}` };
  }

  const rows = await res.json() as unknown[];
  return { rows: rows ?? [] };
}
