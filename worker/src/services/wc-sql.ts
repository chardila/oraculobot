// worker/src/services/wc-sql.ts

const ALLOWED_TABLES = [
  'wc_matches', 'wc_goals', 'wc_teams', 'wc_stadiums',
  'wc_referees', 'wc_referee_appearances',
  'wc_bookings', 'wc_substitutions', 'wc_player_appearances',
  'wc_penalty_kicks', 'wc_group_standings', 'wc_award_winners',
];

export const WC_SCHEMA_PROMPT = `
Tienes acceso a las siguientes tablas de base de datos con historia de Mundiales de Fútbol:

wc_matches(id, year, tournament, phase, home_team, away_team, home_score, away_score, home_ht, away_ht, match_date, ground, extra_time, penalty_shootout, home_penalties, away_penalties)
  - year: número entero (1930, 1934, ..., 2022)
  - tournament: 'FIFA World Cup' o 'FIFA World Cup qualification'
  - phase: 'Group A'..'Group H', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final', 'Qualifying', etc.
  - IMPORTANTE: home_score/away_score es el marcador al final de los 90 minutos, NO incluye goles de prórroga. Para el resultado completo de partidos con extra_time=true, contar goles desde wc_goals.
  - extra_time: true si el partido fue a prórroga
  - penalty_shootout: true si hubo penales; home_penalties/away_penalties tienen los goles de shootout (no están en home_score/away_score)

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
  - Apariciones por partido desde 1930. position_code: 'GK', 'DF', 'MF', 'FW'

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
`.trim();

export function validateWcSql(sql: string): { valid: boolean; error?: string } {
  const trimmed = sql.trim().toLowerCase();

  if (!trimmed.startsWith('select')) {
    return { valid: false, error: 'Query must start with SELECT' };
  }

  const forbidden = /\b(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|pg_)\b/;
  if (forbidden.test(trimmed)) {
    return { valid: false, error: 'Query contains forbidden keywords' };
  }

  // Check all referenced table names are in the allowed list
  const tableRefs = trimmed.match(/\bfrom\s+(\w+)|\bjoin\s+(\w+)/gi) ?? [];
  for (const ref of tableRefs) {
    const table = ref.replace(/\b(from|join)\s+/i, '').trim();
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
