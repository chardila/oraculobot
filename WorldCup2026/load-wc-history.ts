// WorldCup2026/load-wc-history.ts
// Run with: npx tsx load-wc-history.ts
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const GH_BASE      = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master';
const MARTJ_BASE   = 'https://raw.githubusercontent.com/martj42/international_results/master';

const WC_YEARS = [
  1930,1934,1938,1950,1954,1958,1962,1966,1970,
  1974,1978,1982,1986,1990,1994,1998,2002,2006,
  2010,2014,2018,2022,
];

// ── Supabase REST helpers ────────────────────────────────────────────────────

async function supaReq(path: string, options: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=minimal',
      ...(options.headers as Record<string,string> ?? {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${path} ${res.status}: ${txt}`);
  }
}

async function insert(table: string, rows: object[]) {
  if (rows.length === 0) return;
  // Insert in batches of 500 to avoid request size limits
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await supaReq(table, {
      method: 'POST',
      body: JSON.stringify(batch),
      headers: { 'Prefer': 'return=minimal' },
    });
  }
}

async function deleteByYear(table: string, year: number) {
  await supaReq(`${table}?year=eq.${year}`, { method: 'DELETE' });
}

// For goals: delete via match_ids
async function deleteGoalsForYear(year: number) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/wc_matches?year=eq.${year}&select=id`,
    { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
  );
  const matches = await res.json() as { id: number }[];
  const ids = matches.map(m => m.id);
  if (ids.length === 0) return;
  await supaReq(`wc_goals?match_id=in.(${ids.join(',')})`, { method: 'DELETE' });
}

// ── openfootball loaders ─────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function loadWcYear(year: number) {
  process.stdout.write(`Loading ${year}... `);

  // Delete existing data for this year (idempotent)
  await deleteGoalsForYear(year);
  await deleteByYear('wc_matches', year);
  await deleteByYear('wc_teams', year);
  await deleteByYear('wc_stadiums', year);

  // Matches + goals
  const wc = await fetchJson(`${GH_BASE}/${year}/worldcup.json`);
  if (!wc) { console.log('SKIP (no data)'); return; }

  const matchRows: object[] = [];
  const goalRows: { tempMatchIdx: number; team: string; scorer: string; minute: number | null; penalty: boolean; own_goal: boolean }[] = [];

  for (const m of wc.matches) {
    matchRows.push({
      year,
      tournament: 'FIFA World Cup',
      phase: m.group ?? m.round,
      home_team: m.team1,
      away_team: m.team2,
      home_score: m.score?.ft?.[0] ?? null,
      away_score: m.score?.ft?.[1] ?? null,
      home_ht: m.score?.ht?.[0] ?? null,
      away_ht: m.score?.ht?.[1] ?? null,
      match_date: m.date ?? null,
      ground: m.ground ?? null,
    });

    const idx = matchRows.length - 1;
    for (const g of m.goals1 ?? []) {
      goalRows.push({ tempMatchIdx: idx, team: m.team1, scorer: g.name, minute: g.minute ?? null, penalty: !!g.penalty, own_goal: !!g.owngoal });
    }
    for (const g of m.goals2 ?? []) {
      goalRows.push({ tempMatchIdx: idx, team: m.team2, scorer: g.name, minute: g.minute ?? null, penalty: !!g.penalty, own_goal: !!g.owngoal });
    }
  }

  // Insert matches and get back their IDs
  const insertedRes = await fetch(`${SUPABASE_URL}/rest/v1/wc_matches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(matchRows),
  });
  const inserted = await insertedRes.json() as { id: number }[];

  // Insert goals with real match IDs
  const goalInserts = goalRows.map(g => ({
    match_id: inserted[g.tempMatchIdx].id,
    team: g.team,
    scorer: g.scorer,
    minute: g.minute,
    penalty: g.penalty,
    own_goal: g.own_goal,
  }));
  await insert('wc_goals', goalInserts);

  // Teams (only some years have this file)
  const teamsData = await fetchJson(`${GH_BASE}/${year}/worldcup.teams.json`);
  if (teamsData?.teams) {
    await insert('wc_teams', teamsData.teams.map((t: any) => ({
      year, name: t.name, fifa_code: t.code ?? null,
      continent: t.continent ?? null,
      confederation: t.assoc?.continental?.code ?? null,
      group_name: null,
    })));
  }

  // Stadiums (only some years)
  const stadData = await fetchJson(`${GH_BASE}/${year}/worldcup.stadiums.json`);
  if (stadData?.stadiums) {
    await insert('wc_stadiums', stadData.stadiums.map((s: any) => ({
      year, name: s.name, city: s.city ?? null,
      country: null, capacity: s.capacity ?? null,
    })));
  }

  console.log(`${matchRows.length} matches, ${goalInserts.length} goals`);
}

// ── martj42 CSV loaders ──────────────────────────────────────────────────────

async function loadQualifying() {
  process.stdout.write('Loading 2026 qualifying results... ');

  // Delete existing qualifying data
  await supaReq(
    `wc_matches?tournament=eq.${encodeURIComponent('FIFA World Cup qualification')}&year=eq.2026`,
    { method: 'DELETE' }
  );

  const csv = await fetch(`${MARTJ_BASE}/results.csv`).then(r => r.text());
  const lines = csv.split('\n').slice(1).filter(Boolean);

  const rows = lines
    .map(line => {
      const [date, home, away, hs, as_, tournament] = line.split(',');
      return { date, home, away, hs: Number(hs), as_: Number(as_), tournament };
    })
    .filter(r => r.date >= '2023-01-01' && r.tournament === 'FIFA World Cup qualification');

  const matchRows = rows.map(r => ({
    year: 2026,
    tournament: 'FIFA World Cup qualification',
    phase: 'Qualifying',
    home_team: r.home,
    away_team: r.away,
    home_score: isNaN(r.hs) ? null : r.hs,
    away_score: isNaN(r.as_) ? null : r.as_,
    home_ht: null,
    away_ht: null,
    match_date: r.date,
    ground: null,
  }));

  const insertedRes = await fetch(`${SUPABASE_URL}/rest/v1/wc_matches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(matchRows),
  });
  const inserted = await insertedRes.json() as { id: number; home_team: string; away_team: string; match_date: string }[];

  // Build lookup: "date|home|away" → match_id
  const matchLookup = new Map<string, number>();
  for (const m of inserted) {
    matchLookup.set(`${m.match_date}|${m.home_team}|${m.away_team}`, m.id);
  }

  console.log(`${matchRows.length} qualifying matches`);

  // Goals from goalscorers.csv
  process.stdout.write('Loading 2026 qualifying goalscorers... ');
  const gCsv = await fetch(`${MARTJ_BASE}/goalscorers.csv`).then(r => r.text());
  const gLines = gCsv.split('\n').slice(1).filter(Boolean);

  const goalRows: object[] = [];
  for (const line of gLines) {
    const [date, home, away, team, scorer, minute, own_goal, penalty] = line.split(',');
    if (date < '2023-01-01') continue;
    const matchId = matchLookup.get(`${date}|${home}|${away}`);
    if (!matchId) continue;
    goalRows.push({
      match_id: matchId,
      team,
      scorer,
      minute: minute ? Number(minute) : null,
      penalty: penalty?.trim() === 'TRUE',
      own_goal: own_goal?.trim() === 'TRUE',
    });
  }

  await insert('wc_goals', goalRows);
  console.log(`${goalRows.length} qualifying goals`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars');
  }

  for (const year of WC_YEARS) {
    await loadWcYear(year);
  }

  await loadQualifying();

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
