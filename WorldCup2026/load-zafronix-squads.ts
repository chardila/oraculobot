// Run with: npx tsx WorldCup2026/load-zafronix-squads.ts
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ZAFRONIX_API_KEY
// Re-runnable: safe to execute multiple times as squads finalize before the tournament.
// Each run replaces all squad data per team (delete + insert).
// Typically costs 1 API request (the /tournaments/2026 endpoint returns all teams).

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY!;
const ZAFRONIX_KEY  = process.env.ZAFRONIX_API_KEY!;

const ZAFRONIX_URL  = 'https://api.zafronix.com/fifa/worldcup/v1/tournaments/2026';

// ── Supabase REST helpers ────────────────────────────────────────────────────

async function supaPost(path: string, rows: object[], prefer = 'return=minimal') {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': prefer,
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${await res.text()}`);
  }
}

async function supaDelete(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`DELETE ${path} ${res.status}: ${await res.text()}`);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ZafronixPlayer {
  jersey: number | null;      // null until assigned ~days before tournament
  name: string;
  position: string;           // 'GK', 'DF', 'MF', 'FW'
  born: string | null;        // ISO date or null
  ageAtTournament: number | null;
  club: { name: string; country: string } | null;
  goals: number;
  captain?: boolean;
  preliminary?: boolean;      // true if still on pre-selection list
}

interface ZafronixTeam {
  name: string;
  squad: ZafronixPlayer[];
}

// ── Name mapping ─────────────────────────────────────────────────────────────
// Only 2 differences between Zafronix names and our matches table

const TEAM_NAME_MAP: Record<string, string> = {
  'United States':            'USA',
  'Bosnia and Herzegovina':   'Bosnia & Herzegovina',
};

function norm(name: string): string {
  return TEAM_NAME_MAP[name] ?? name;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars');
  }
  if (!ZAFRONIX_KEY) {
    throw new Error('Set ZAFRONIX_API_KEY env var');
  }

  console.log(`Fetching all 2026 WC squads from Zafronix (1 API call)...`);
  const res = await fetch(ZAFRONIX_URL, {
    headers: { 'X-API-Key': ZAFRONIX_KEY },
  });
  if (!res.ok) throw new Error(`Zafronix API ${res.status}: ${await res.text()}`);

  const data = await res.json() as { tournament: unknown; teams: ZafronixTeam[] };
  console.log(`Received ${data.teams.length} teams from Zafronix`);

  let totalPlayers = 0;
  const skippedTeams: string[] = [];

  for (const team of data.teams) {
    const dbTeam = norm(team.name);

    if (!team.squad || team.squad.length === 0) {
      console.log(`  Skipping ${team.name} (no squad announced yet)`);
      skippedTeams.push(team.name);
      continue;
    }

    process.stdout.write(`  ${dbTeam}: ${team.squad.length} players... `);

    // Delete-then-insert for idempotency
    await supaDelete(`wc_squads_2026?team=eq.${encodeURIComponent(dbTeam)}`);

    const rows = team.squad.map((p: ZafronixPlayer) => ({
      team:              dbTeam,
      jersey_number:     p.jersey ?? null,
      player_name:       p.name,
      position:          p.position || null,
      born:              p.born ?? null,
      age_at_tournament: p.ageAtTournament ?? null,
      club_name:         p.club?.name ?? null,
      club_country:      p.club?.country ?? null,
      goals:             p.goals ?? 0,
      captain:           p.captain ?? false,
      preliminary:       p.preliminary ?? false,
    }));

    await supaPost('wc_squads_2026', rows);
    totalPlayers += rows.length;
    console.log('done');
  }

  console.log('\n── Summary ─────────────────────────────────────────────────');
  console.log(`  Total players loaded : ${totalPlayers}`);
  console.log(`  Teams skipped        : ${skippedTeams.length} (${skippedTeams.join(', ') || 'none'})`);
  console.log(`  API requests used    : 1`);
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
