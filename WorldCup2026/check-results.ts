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

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
  score: FdScore;
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
    if (!fdMatch) {
      console.log(`${match.home_team} vs ${match.away_team}: no encontrado en football-data.org todavía`);
      continue;
    }

    console.log(`${match.home_team} vs ${match.away_team}: score=${JSON.stringify(fdMatch.score.fullTime)} duration=${fdMatch.score.duration}`);

    // Send proposal to worker
    const proposeRes = await fetch(`${WORKER_URL}/api/admin/propose-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': WORKER_ADMIN_SECRET,
      },
      body: JSON.stringify({ match_id: match.id, fd_match: fdMatch }),
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
}

main().catch(err => { console.error(err); process.exit(1); });
