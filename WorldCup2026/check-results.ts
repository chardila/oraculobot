// WorldCup2026/check-results.ts
// Run via GitHub Actions every 30 min to detect finished matches and propose results to admin.
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, FOOTBALL_DATA_TOKEN, WORKER_URL, WORKER_ADMIN_SECRET

const SUPABASE_URL        = process.env.SUPABASE_URL!;
const SERVICE_KEY         = process.env.SUPABASE_SERVICE_KEY!;
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN!;
const WORKER_URL          = process.env.WORKER_URL!;
const WORKER_ADMIN_SECRET = process.env.WORKER_ADMIN_SECRET!;

// football-data.org name → our DB name (only differences)
const TEAM_NAME_MAP: Record<string, string> = {
  'United States':       'USA',
  'Bosnia-Herzegovina':  'Bosnia & Herzegovina',
  'Cape Verde Islands':  'Cape Verde',
  'Congo DR':            'DR Congo',
  'Czechia':             'Czech Republic',
};

function norm(name: string): string {
  return TEAM_NAME_MAP[name] ?? name;
}

// FIFA API name → our DB name (only differences from FIFA naming)
const FIFA_TEAM_MAP: Record<string, string> = {
  'Korea Republic':          'South Korea',
  'Czechia':                 'Czech Republic',
  'Bosnia and Herzegovina':  'Bosnia & Herzegovina',
  'Türkiye':                 'Turkey',
  "Côte d'Ivoire":           'Ivory Coast',
  'Cabo Verde':              'Cape Verde',
  'IR Iran':                 'Iran',
  'Congo DR':                'DR Congo',
};

function normFifa(name: string): string {
  return FIFA_TEAM_MAP[name] ?? name;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface OurMatch {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  phase: string;
}

interface FdScore {
  winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
  duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
  fullTime: { home: number | null; away: number | null };
  regularTime: { home: number | null; away: number | null } | null;
  overtime: { home: number | null; away: number | null } | null;
  penalties: { home: number | null; away: number | null } | null;
}

interface FdReferee {
  name: string;
  type: string;
  nationality: string;
}

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
  score: FdScore;
  referees: FdReferee[];
}

// Minimal shape of what propose-result.ts expects in fd_match
type ProposeMatchPayload = {
  score: FdScore;
  homeTeam: { name: string };
  awayTeam: { name: string };
};

// Fields returned by the undocumented FIFA calendar API that we use
interface FifaApiMatch {
  IdCompetition: string;
  IdSeason: string;
  IdMatch: string;
  MatchStatus: number; // 0 = finished
  Date: string;        // UTC ISO string e.g. "2026-06-28T19:00:00Z"
  StageName: Array<{ Locale: string; Description: string }> | null;
  Home: { TeamName: Array<{ Description: string }>; Score: number | null } | null;
  Away: { TeamName: Array<{ Description: string }>; Score: number | null } | null;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function supaGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function supaUpsert(path: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  url.searchParams.set('on_conflict', onConflict);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${path}: ${res.status} ${await res.text()}`);
}

async function supaPatch(path: string, id: string, data: Record<string, unknown>): Promise<void> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  url.searchParams.set('id', `eq.${id}`);
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${path}: ${res.status} ${await res.text()}`);
}

async function syncReferees(): Promise<void> {
  const res = await fetch(
    'https://api.football-data.org/v4/competitions/WC/matches?season=2026',
    { headers: { 'X-Auth-Token': FOOTBALL_DATA_TOKEN } }
  );
  if (!res.ok) {
    console.error(`referee sync fetch failed: ${res.status}`);
    return;
  }
  const { matches: fdMatches } = await res.json() as { matches: FdMatch[] };

  const ourMatches = await supaGet<OurMatch[]>('matches', {
    select: 'id,home_team,away_team,kickoff_at,phase',
  });

  let updated = 0;
  for (const our of ourMatches) {
    const fd = findFdMatch(fdMatches, our);
    if (!fd) continue;
    const main = fd.referees?.find(r => r.type === 'REFEREE');
    if (!main) continue;
    await supaPatch('matches', our.id, { referee: main.name });
    updated++;
  }
  console.log(`✅ Árbitros sincronizados: ${updated} partido(s) actualizados`);
}

async function syncStandings(): Promise<void> {
  const res = await fetch(
    'https://api.football-data.org/v4/competitions/WC/standings?season=2026',
    { headers: { 'X-Auth-Token': FOOTBALL_DATA_TOKEN } }
  );
  if (!res.ok) {
    console.error(`standings fetch failed: ${res.status}`);
    return;
  }
  const { standings } = await res.json() as { standings: Array<{ group: string | null; table: Array<{
    team: { name: string };
    playedGames: number;
    won: number;
    draw: number;
    lost: number;
    goalsScored: number;
    goalsConceded: number;
    goalDifference: number;
    points: number;
  }> }> };

  // Before tournament starts, API returns group: null with all 48 teams in one table.
  // Only process once groups are populated (GROUP_A .. GROUP_L).
  const grouped = standings.filter(s => s.group !== null);
  if (grouped.length === 0) {
    console.log('Standings: no group data yet (tournament not started)');
    return;
  }

  const now = new Date().toISOString();
  const rows = grouped.flatMap((group) =>
    group.table.map((entry, i) => ({
      group_name: group.group.replace('GROUP_', ''),
      position: i + 1,
      team: norm(entry.team.name),
      played: entry.playedGames,
      wins: entry.won,
      draws: entry.draw,
      losses: entry.lost,
      goals_for: entry.goalsScored,
      goals_against: entry.goalsConceded,
      goal_difference: entry.goalDifference,
      points: entry.points,
      updated_at: now,
    }))
  );

  await supaUpsert('wc_standings_2026', rows, 'group_name,team');
  console.log(`✅ Standings sincronizados: ${rows.length} filas (${grouped.length} grupos)`);
}

// ── Match lookup ──────────────────────────────────────────────────────────────

function findFdMatch(fdMatches: FdMatch[], our: OurMatch): FdMatch | undefined {
  const ourDate = our.kickoff_at.slice(0, 10); // "2026-06-14"
  return fdMatches.find(fd => {
    const fdDate = fd.utcDate.slice(0, 10);
    if (fdDate !== ourDate) return false;
    const fdHome = norm(fd.homeTeam.name);
    const fdAway = norm(fd.awayTeam.name);
    return fdHome === our.home_team && fdAway === our.away_team;
  });
}

// ── FIFA fallback ─────────────────────────────────────────────────────────────
// Queries the undocumented FIFA calendar API when football-data.org has no data yet.
// Returns null on any failure (all errors logged but swallowed).

async function tryFifaFallback(match: OurMatch): Promise<{
  payload: ProposeMatchPayload;
  source: 'fifa';
} | null> {
  const matchDate = match.kickoff_at.slice(0, 10); // 'YYYY-MM-DD' in UTC

  try {
    const url = new URL('https://api.fifa.com/api/v3/calendar/matches');
    url.searchParams.set('count', '500');
    url.searchParams.set('language', 'en');
    url.searchParams.set('from', `${matchDate}T00:00:00Z`);
    url.searchParams.set('to', `${matchDate}T23:59:59Z`);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[FIFA] HTTP ${res.status} buscando ${match.home_team} vs ${match.away_team} (${matchDate})`);
      return null;
    }

    const data = await res.json() as { Results?: FifaApiMatch[] };
    const fifaMatch = (data.Results ?? []).find(m =>
      m.IdCompetition === '17' &&
      m.IdSeason === '285023' &&
      normFifa(m.Home?.TeamName?.[0]?.Description ?? '') === match.home_team &&
      normFifa(m.Away?.TeamName?.[0]?.Description ?? '') === match.away_team
    );

    if (!fifaMatch) {
      console.log(`[FIFA] ${match.home_team} vs ${match.away_team}: no encontrado en respuesta FIFA (${matchDate})`);
      return null;
    }

    if (fifaMatch.MatchStatus !== 0) {
      console.log(`[FIFA] ${match.home_team} vs ${match.away_team}: MatchStatus=${fifaMatch.MatchStatus} (aún no terminado)`);
      return null;
    }

    const homeScore = fifaMatch.Home?.Score;
    const awayScore = fifaMatch.Away?.Score;

    if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) {
      console.log(`[FIFA] ${match.home_team} vs ${match.away_team}: marcador nulo (matchId: ${fifaMatch.IdMatch})`);
      return null;
    }

    const winner: FdScore['winner'] =
      homeScore > awayScore ? 'HOME_TEAM' :
      awayScore > homeScore ? 'AWAY_TEAM' : 'DRAW';

    console.log(`[FIFA] ✅ ${match.home_team} ${homeScore}-${awayScore} ${match.away_team} (matchId: ${fifaMatch.IdMatch})`);

    return {
      payload: {
        score: {
          winner,
          duration: 'REGULAR',
          fullTime:    { home: homeScore, away: awayScore },
          regularTime: null,
          overtime:    null,
          penalties:   null,
        },
        homeTeam: { name: match.home_team },
        awayTeam: { name: match.away_team },
      },
      source: 'fifa',
    };
  } catch (err) {
    console.warn(`[FIFA] Error inesperado para ${match.home_team} vs ${match.away_team}:`, err);
    return null;
  }
}

// ── Knockout bracket sync ─────────────────────────────────────────────────────

function isPlaceholder(name: string): boolean {
  // e.g. "2A", "1E", "3A/B/C/D/F", "W73", "L101"
  return /^[123][A-L](\/[A-L])*$/.test(name) || /^[WL]\d+$/.test(name);
}

function getFifaTeamName(team: FifaApiMatch['Home']): string | null {
  if (!team?.TeamName?.length) return null;
  const entry = team.TeamName.find(t => t?.Locale?.toLowerCase().includes('en')) ?? team.TeamName[0];
  return entry?.Description ?? null;
}

async function triggerSiteRebuild(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  const res = await fetch(
    'https://api.github.com/repos/chardila/oraculobot/actions/workflows/build-site.yml/dispatches',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  if (!res.ok) {
    console.warn(`[Bracket] site rebuild trigger failed: ${res.status}`);
  } else {
    console.log('[Bracket] ✅ Site rebuild triggered');
  }
}

async function syncKnockoutTeams(): Promise<void> {
  const url = new URL('https://api.fifa.com/api/v3/calendar/matches');
  url.searchParams.set('count', '500');
  url.searchParams.set('language', 'en');
  url.searchParams.set('from', '2026-06-27T00:00:00Z');
  url.searchParams.set('to', '2026-07-05T00:00:00Z');

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error(`[Bracket] FIFA API error: ${res.status}`);
    return;
  }

  const data = await res.json() as { Results?: FifaApiMatch[] };
  const fifaR32 = (data.Results ?? []).filter(m =>
    m.IdCompetition === '17' &&
    m.IdSeason === '285023' &&
    (m.StageName ?? []).some(s => s.Description?.includes('32'))
  );

  if (fifaR32.length === 0) {
    console.log('[Bracket] No R32 matches found in FIFA API yet');
    return;
  }

  const ourMatches = await supaGet<OurMatch[]>('matches', {
    select: 'id,home_team,away_team,kickoff_at,phase',
    phase: 'eq.treintaidosavos',
  });

  const pending = ourMatches.filter(m => isPlaceholder(m.home_team) || isPlaceholder(m.away_team));
  if (pending.length === 0) {
    console.log('[Bracket] R32: todos los equipos ya definidos');
    return;
  }

  let updated = 0;
  for (const fifa of fifaR32) {
    const homeTeam = getFifaTeamName(fifa.Home);
    const awayTeam = getFifaTeamName(fifa.Away);
    if (!homeTeam || !awayTeam) continue; // TBD

    const fifaTime = (fifa.Date ?? '').slice(0, 16); // "2026-06-28T19:00"
    const ourMatch = pending.find(m => m.kickoff_at.slice(0, 16) === fifaTime);
    if (!ourMatch) continue;

    await supaPatch('matches', ourMatch.id, {
      home_team: normFifa(homeTeam),
      away_team: normFifa(awayTeam),
    });
    console.log(`[Bracket] ✅ ${normFifa(homeTeam)} vs ${normFifa(awayTeam)} (${fifaTime})`);
    updated++;
  }

  const remaining = pending.length - updated;
  console.log(`[Bracket] R32: ${updated} actualizado(s), ${remaining} aún TBD`);

  if (updated > 0) {
    await triggerSiteRebuild();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY || !FOOTBALL_DATA_TOKEN || !WORKER_URL || !WORKER_ADMIN_SECRET) {
    console.error('Missing required env vars');
    process.exit(1);
  }

  // 1. Find matches that should be finished (kickoff > 150 min ago) but have no result yet
  const cutoff = new Date(Date.now() - 150 * 60 * 1000).toISOString();
  const pending = await supaGet<OurMatch[]>('matches', {
    select: 'id,home_team,away_team,kickoff_at,phase',
    status: 'eq.scheduled',
    kickoff_at: `lt.${cutoff}`,
  });

  if (!pending.length) {
    console.log('No hay partidos pendientes de resultado.');
  } else {
    console.log(`${pending.length} partido(s) pendiente(s) de resultado.`);

  // 2. Fetch finished matches from football-data.org
  const fdRes = await fetch(
    'https://api.football-data.org/v4/competitions/WC/matches?season=2026&status=FINISHED',
    { headers: { 'X-Auth-Token': FOOTBALL_DATA_TOKEN } }
  );
  if (!fdRes.ok) throw new Error(`football-data.org: ${fdRes.status} ${await fdRes.text()}`);
  const { matches: fdMatches } = await fdRes.json() as { matches: FdMatch[] };
  console.log(`football-data.org reporta ${fdMatches.length} partido(s) terminado(s).`);

  // 3. For each pending match, check if it's finished and propose result
  for (const match of pending) {
    // Skip if there's already a pending proposal
    const existing = await supaGet<{ id: string }[]>('proposed_results', {
      select: 'id',
      match_id: `eq.${match.id}`,
      status: 'eq.pending',
      limit: '1',
    });
    if (existing.length) {
      console.log(`${match.home_team} vs ${match.away_team}: ya tiene propuesta pendiente — omitido`);
      continue;
    }

    const fdMatch = findFdMatch(fdMatches, match);

    let proposePayload: ProposeMatchPayload | null = null;
    let proposeSource = 'football-data';

    if (fdMatch) {
      // football-data.org sometimes returns FINISHED matches with null scores due to CDN caching delays
      if (!fdMatch.score.winner || fdMatch.score.fullTime.home === null || fdMatch.score.fullTime.away === null) {
        console.log(`${match.home_team} vs ${match.away_team}: marcador aún no disponible en football-data.org, se reintentará`);
        continue;
      }
      proposePayload = fdMatch;
    } else {
      console.log(`${match.home_team} vs ${match.away_team}: no en football-data.org, probando FIFA...`);
      const fifaResult = await tryFifaFallback(match);
      if (!fifaResult) {
        console.log(`${match.home_team} vs ${match.away_team}: sin datos en ninguna fuente todavía`);
        continue;
      }
      proposePayload = fifaResult.payload;
      proposeSource  = fifaResult.source;
    }

    // Send proposal to worker
    const proposeRes = await fetch(`${WORKER_URL}/api/admin/propose-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': WORKER_ADMIN_SECRET,
      },
      body: JSON.stringify({ match_id: match.id, fd_match: proposePayload, source: proposeSource }),
    });

    if (!proposeRes.ok) {
      const body = await proposeRes.text();
      if (proposeRes.status === 422 && body.includes('score_not_available_yet')) {
        console.log(`${match.home_team} vs ${match.away_team}: marcador aún no disponible en football-data.org, se reintentará`);
      } else {
        console.error(`Error proponiendo ${match.home_team} vs ${match.away_team}: ${proposeRes.status} ${body}`);
      }
    } else {
      const result = await proposeRes.json() as { ok: boolean; skipped?: string; proposal_id?: string };
      if (result.skipped) {
        console.log(`${match.home_team} vs ${match.away_team}: omitido (${result.skipped})`);
      } else {
        console.log(`✅ Propuesta enviada: ${match.home_team} vs ${match.away_team} (${result.proposal_id})`);
      }
    }
  } // end for (match of pending)
  } // end else (pending.length > 0)

  // Sync standings regardless of pending matches
  try {
    await syncStandings();
  } catch (err) {
    console.error('standings sync error (non-fatal):', err);
  }

  // Sync referee assignments regardless of pending matches
  try {
    await syncReferees();
  } catch (err) {
    console.error('referee sync error (non-fatal):', err);
  }

  // Fill in real team names for Round of 32 as groups conclude
  try {
    await syncKnockoutTeams();
  } catch (err) {
    console.error('bracket sync error (non-fatal):', err);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
