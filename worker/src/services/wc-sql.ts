// worker/src/services/wc-sql.ts

const ALLOWED_TABLES = ['wc_matches', 'wc_goals', 'wc_teams', 'wc_stadiums'];

export const WC_SCHEMA_PROMPT = `
Tienes acceso a las siguientes tablas de base de datos con historia de Mundiales de Fútbol:

wc_matches(id, year, tournament, phase, home_team, away_team, home_score, away_score, home_ht, away_ht, match_date, ground)
  - year: número entero (1930, 1934, ..., 2022)
  - tournament: 'FIFA World Cup' o 'FIFA World Cup qualification'
  - phase: 'Group A'..'Group H', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final', 'Qualifying', etc.
  - home_score/away_score: null si el partido no se ha jugado
  - home_ht/away_ht: marcador al descanso (puede ser null)

wc_goals(id, match_id, team, scorer, minute, penalty, own_goal)
  - match_id: referencia a wc_matches.id
  - penalty: true/false
  - own_goal: true/false

wc_teams(id, year, name, fifa_code, continent, confederation, group_name)
  - confederation: 'UEFA', 'CONMEBOL', 'CONCACAF', 'CAF', 'AFC', 'OFC'
  - Solo disponible para años con datos de equipos (2014, 2018)

wc_stadiums(id, year, name, city, country, capacity)
  - Solo disponible para años con datos de estadios (2014, 2018, 2022)

Ejemplos de consultas:
- Goles de Messi en 2022: SELECT scorer, COUNT(*) as goles FROM wc_goals g JOIN wc_matches m ON g.match_id = m.id WHERE m.year = 2022 AND m.tournament = 'FIFA World Cup' AND g.scorer ILIKE '%Messi%' GROUP BY scorer
- Resultado final 2018: SELECT home_team, home_score, away_score, away_team FROM wc_matches WHERE year = 2018 AND phase = 'Final'
- Partidos de Colombia en eliminatorias: SELECT match_date, home_team, home_score, away_score, away_team FROM wc_matches WHERE year = 2026 AND tournament = 'FIFA World Cup qualification' AND (home_team = 'Colombia' OR away_team = 'Colombia') ORDER BY match_date
- Goleadores de un torneo: SELECT scorer, COUNT(*) as goles FROM wc_goals g JOIN wc_matches m ON g.match_id = m.id WHERE m.year = 2014 AND m.tournament = 'FIFA World Cup' AND g.own_goal = false GROUP BY scorer ORDER BY goles DESC LIMIT 10
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
