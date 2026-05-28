// WorldCup2026/load-jfjelstul-history.ts
// Run with: npx tsx load-jfjelstul-history.ts
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const JF_URL       = 'https://raw.githubusercontent.com/jfjelstul/worldcup/master/data-json/worldcup.json';

// ── Supabase REST helpers ────────────────────────────────────────────────────

async function supaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

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

async function supaPatch(path: string, body: object) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} ${res.status}: ${await res.text()}`);
}

async function supaDelete(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`DELETE ${path} ${res.status}: ${await res.text()}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function playerName(given: string, family: string): string {
  return [given, family]
    .filter(s => s && s.toLowerCase() !== 'not applicable')
    .join(' ')
    .trim();
}

function wcYear(tournamentId: string): number {
  return parseInt(tournamentId.replace('WC-', ''));
}

// jfjelstul uses different team names than openfootball in some cases
const TEAM_NAME_MAP: Record<string, string> = {
  'United States':        'USA',
  'Republic of Ireland':  'Ireland',
  'Ivory Coast':          "Côte d'Ivoire",
  'Bosnia and Herzegovina': 'Bosnia-Herzegovina',
  'Korea DPR':            'North Korea',
};

function norm(name: string): string {
  return TEAM_NAME_MAP[name] ?? name;
}

// ── Build match lookup ───────────────────────────────────────────────────────

type OurMatch = { id: number; year: number; match_date: string; home_team: string; away_team: string };
type JfMatch  = {
  match_id: string; tournament_id: string; replay: number; replayed: number;
  match_date: string; home_team_name: string; away_team_name: string;
  extra_time: number; penalty_shootout: number; score_penalties: string;
  home_team_score_penalties: number; away_team_score_penalties: number;
};

async function buildMatchLookup(jfMatches: JfMatch[]): Promise<Map<string, number>> {
  console.log('Building match lookup...');
  const ourMatches = await supaGet<OurMatch[]>(
    `wc_matches?tournament=eq.FIFA%20World%20Cup&select=id,year,match_date,home_team,away_team`
  );

  // Primary: year|date|home|away — precise, resolves teams that meet twice (e.g. England-Belgium 2018)
  const byDate = new Map<string, number>();
  // Fallback: year|home|away — for edge cases where date might differ; first entry wins
  const byTeams = new Map<string, number>();
  for (const m of ourMatches) {
    byDate.set(`${m.year}|${m.match_date}|${m.home_team}|${m.away_team}`, m.id);
    byDate.set(`${m.year}|${m.match_date}|${m.away_team}|${m.home_team}`, m.id);
    if (!byTeams.has(`${m.year}|${m.home_team}|${m.away_team}`)) {
      byTeams.set(`${m.year}|${m.home_team}|${m.away_team}`, m.id);
      byTeams.set(`${m.year}|${m.away_team}|${m.home_team}`, m.id);
    }
  }

  const lookup = new Map<string, number>();
  let linked = 0, skipped = 0, unlinked = 0;

  for (const jfm of jfMatches) {
    if (jfm.replay === 1) { skipped++; continue; }
    const year = wcYear(jfm.tournament_id);
    const home = norm(jfm.home_team_name);
    const away = norm(jfm.away_team_name);
    // Try normalized names first, then fall back to original jfjelstul names
    // (openfootball uses "United States" pre-1994 but "USA" from 1994 onward)
    const jfHome = jfm.home_team_name, jfAway = jfm.away_team_name;
    const ourId = byDate.get(`${year}|${jfm.match_date}|${home}|${away}`)
               ?? byDate.get(`${year}|${jfm.match_date}|${away}|${home}`)
               ?? byDate.get(`${year}|${jfm.match_date}|${jfHome}|${jfAway}`)
               ?? byDate.get(`${year}|${jfm.match_date}|${jfAway}|${jfHome}`)
               ?? byTeams.get(`${year}|${home}|${away}`)
               ?? byTeams.get(`${year}|${jfHome}|${jfAway}`);
    if (ourId) {
      lookup.set(jfm.match_id, ourId);
      linked++;
    } else {
      console.warn(`  Unlinked: ${year} ${jfm.home_team_name} vs ${jfm.away_team_name} (${jfm.match_id})`);
      unlinked++;
    }
  }

  console.log(`  Linked: ${linked} | Unlinked: ${unlinked} | Replays skipped: ${skipped}`);
  return lookup;
}

// ── Enrich wc_matches ────────────────────────────────────────────────────────

async function enrichMatches(jfMatches: JfMatch[], lookup: Map<string, number>) {
  process.stdout.write('Enriching wc_matches... ');
  let updated = 0;
  for (const jfm of jfMatches) {
    if (jfm.replay === 1) continue;
    const ourId = lookup.get(jfm.match_id);
    if (!ourId) continue;

    await supaPatch(`wc_matches?id=eq.${ourId}`, {
      jfjelstul_match_id: jfm.match_id,
      extra_time:        jfm.extra_time === 1,
      penalty_shootout:  jfm.penalty_shootout === 1,
      home_penalties:    jfm.penalty_shootout === 1 ? jfm.home_team_score_penalties : null,
      away_penalties:    jfm.penalty_shootout === 1 ? jfm.away_team_score_penalties : null,
    });
    updated++;
  }
  console.log(`${updated} matches enriched`);
}

// ── Load referees ─────────────────────────────────────────────────────────────

type JfReferee = {
  referee_id: string; family_name: string; given_name: string;
  country_name: string; confederation_code: string;
};
type JfRefApp = {
  tournament_id: string; match_id: string;
  referee_id: string; family_name: string; given_name: string; country_name: string;
};

async function loadReferees(referees: JfReferee[], appearances: JfRefApp[], lookup: Map<string, number>) {
  process.stdout.write('Loading referees... ');

  // Delete appearances first (they reference referees via FK), then referees
  await supaDelete('wc_referee_appearances?id=gte.1');
  await supaDelete('wc_referees?id=gte.1');
  const refRows = referees.map(r => ({
    jfjelstul_referee_id: r.referee_id,
    family_name:          r.family_name,
    given_name:           r.given_name || null,
    country_name:         r.country_name || null,
    confederation_code:   r.confederation_code || null,
  }));
  await supaPost('wc_referees', refRows);

  // Referee appearances: build referee lookup by jfjelstul_referee_id → our wc_referees.id
  const insertedRefs = await supaGet<{ id: number; jfjelstul_referee_id: string }[]>(
    'wc_referees?select=id,jfjelstul_referee_id'
  );
  const refLookup = new Map(insertedRefs.map(r => [r.jfjelstul_referee_id, r.id]));

  const appRows: object[] = [];
  for (const a of appearances) {
    const matchId = lookup.get(a.match_id);
    if (!matchId) continue;
    appRows.push({
      match_id:    matchId,
      referee_id:  refLookup.get(a.referee_id) ?? null,
      family_name: a.family_name,
      given_name:  a.given_name || null,
      country_name: a.country_name || null,
    });
  }
  await supaPost('wc_referee_appearances', appRows);
  console.log(`${refRows.length} referees, ${appRows.length} appearances`);
}

// ── Load bookings ─────────────────────────────────────────────────────────────

type JfBooking = {
  match_id: string; team_name: string;
  family_name: string; given_name: string; shirt_number: number;
  minute_regulation: number; minute_stoppage: number; match_period: string;
  yellow_card: number; red_card: number; second_yellow_card: number;
};

async function loadBookings(bookings: JfBooking[], lookup: Map<string, number>) {
  process.stdout.write('Loading bookings... ');
  await supaDelete('wc_bookings?id=gte.1');
  const rows: object[] = [];
  for (const b of bookings) {
    const matchId = lookup.get(b.match_id);
    if (!matchId) continue;
    rows.push({
      match_id:           matchId,
      team:               b.team_name,
      player_name:        playerName(b.given_name, b.family_name),
      shirt_number:       b.shirt_number || null,
      minute_regulation:  b.minute_regulation || null,
      minute_stoppage:    b.minute_stoppage || null,
      match_period:       b.match_period || null,
      yellow_card:        b.yellow_card === 1,
      red_card:           b.red_card === 1,
      second_yellow_card: b.second_yellow_card === 1,
    });
  }
  await supaPost('wc_bookings', rows);
  console.log(`${rows.length} bookings`);
}

// ── Load substitutions ────────────────────────────────────────────────────────

type JfSubstitution = {
  match_id: string; team_name: string;
  family_name: string; given_name: string; shirt_number: number;
  minute_regulation: number; minute_stoppage: number; match_period: string;
  going_off: number; coming_on: number;
};

async function loadSubstitutions(subs: JfSubstitution[], lookup: Map<string, number>) {
  process.stdout.write('Loading substitutions... ');
  await supaDelete('wc_substitutions?id=gte.1');
  const rows: object[] = [];
  for (const s of subs) {
    const matchId = lookup.get(s.match_id);
    if (!matchId) continue;
    rows.push({
      match_id:          matchId,
      team:              s.team_name,
      player_name:       playerName(s.given_name, s.family_name),
      shirt_number:      s.shirt_number || null,
      minute_regulation: s.minute_regulation || null,
      minute_stoppage:   s.minute_stoppage || null,
      match_period:      s.match_period || null,
      going_off:         s.going_off === 1,
      coming_on:         s.coming_on === 1,
    });
  }
  await supaPost('wc_substitutions', rows);
  console.log(`${rows.length} substitutions`);
}

// ── Load player appearances ───────────────────────────────────────────────────

type JfPlayerAppearance = {
  match_id: string; team_name: string;
  family_name: string; given_name: string; shirt_number: number;
  position_name: string; position_code: string;
  starter: number; substitute: number;
};

async function loadPlayerAppearances(appearances: JfPlayerAppearance[], lookup: Map<string, number>) {
  process.stdout.write('Loading player appearances... ');
  await supaDelete('wc_player_appearances?id=gte.1');
  const rows: object[] = [];
  for (const a of appearances) {
    const matchId = lookup.get(a.match_id);
    if (!matchId) continue;
    rows.push({
      match_id:      matchId,
      team:          a.team_name,
      player_name:   playerName(a.given_name, a.family_name),
      shirt_number:  a.shirt_number || null,
      position_name: a.position_name || null,
      position_code: a.position_code || null,
      starter:       a.starter === 1,
      substitute:    a.substitute === 1,
    });
  }
  await supaPost('wc_player_appearances', rows);
  console.log(`${rows.length} appearances`);
}

// ── Load penalty kicks ────────────────────────────────────────────────────────

type JfPenaltyKick = {
  match_id: string; team_name: string;
  family_name: string; given_name: string; shirt_number: number;
  converted: number;
};

async function loadPenaltyKicks(kicks: JfPenaltyKick[], lookup: Map<string, number>) {
  process.stdout.write('Loading penalty kicks... ');
  await supaDelete('wc_penalty_kicks?id=gte.1');
  const rows: object[] = [];
  for (const k of kicks) {
    const matchId = lookup.get(k.match_id);
    if (!matchId) continue;
    rows.push({
      match_id:     matchId,
      team:         k.team_name,
      player_name:  playerName(k.given_name, k.family_name),
      shirt_number: k.shirt_number || null,
      converted:    k.converted === 1,
    });
  }
  await supaPost('wc_penalty_kicks', rows);
  console.log(`${rows.length} penalty kicks`);
}

// ── Load group standings ──────────────────────────────────────────────────────

type JfGroupStanding = {
  tournament_id: string; group_name: string; position: number; team_name: string;
  played: number; wins: number; draws: number; losses: number;
  goals_for: number; goals_against: number; goal_difference: number; points: number; advanced: number;
};

async function loadGroupStandings(standings: JfGroupStanding[]) {
  process.stdout.write('Loading group standings... ');
  await supaDelete('wc_group_standings?id=gte.1');
  const rows = standings.map(s => ({
    year:            wcYear(s.tournament_id),
    group_name:      s.group_name,
    position:        s.position,
    team:            s.team_name,
    played:          s.played,
    wins:            s.wins,
    draws:           s.draws,
    losses:          s.losses,
    goals_for:       s.goals_for,
    goals_against:   s.goals_against,
    goal_difference: s.goal_difference,
    points:          s.points,
    advanced:        s.advanced === 1,
  }));
  await supaPost('wc_group_standings', rows);
  console.log(`${rows.length} group standings rows`);
}

// ── Load award winners ────────────────────────────────────────────────────────

type JfAwardWinner = {
  tournament_id: string; award_name: string;
  family_name: string; given_name: string; team_name: string; shared: number;
};

async function loadAwardWinners(winners: JfAwardWinner[]) {
  process.stdout.write('Loading award winners... ');
  await supaDelete('wc_award_winners?id=gte.1');
  const rows = winners.map(w => ({
    year:        wcYear(w.tournament_id),
    award_name:  w.award_name,
    player_name: playerName(w.given_name, w.family_name),
    team:        w.team_name,
    shared:      w.shared === 1,
  }));
  await supaPost('wc_award_winners', rows);
  console.log(`${rows.length} award winners`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars');
  }

  console.log('Downloading jfjelstul worldcup.json (~35MB)...');
  const res = await fetch(JF_URL);
  if (!res.ok) throw new Error(`Failed to download jfjelstul data: ${res.status}`);
  const jf = await res.json() as Record<string, any[]>;
  console.log(`Downloaded. Top-level keys: ${Object.keys(jf).join(', ')}`);

  // jfjelstul names: "1930 FIFA Men's World Cup" / "1991 FIFA Women's World Cup"
  const mensWCIds = new Set(
    (jf.tournaments as Array<{ tournament_id: string; tournament_name: string }>)
      .filter(t => t.tournament_name.includes("Men's"))
      .map(t => t.tournament_id)
  );
  console.log(`Men's WC tournaments: ${mensWCIds.size}`);

  const isMens = (tid: string) => mensWCIds.has(tid);

  const matches = (jf.matches as JfMatch[]).filter(m => isMens(m.tournament_id));
  const lookup  = await buildMatchLookup(matches);

  await enrichMatches(matches, lookup);
  await loadReferees(jf.referees as JfReferee[], jf.referee_appearances as JfRefApp[], lookup);
  await loadBookings(jf.bookings as JfBooking[], lookup);
  await loadSubstitutions(jf.substitutions as JfSubstitution[], lookup);
  await loadPlayerAppearances(jf.player_appearances as JfPlayerAppearance[], lookup);
  await loadPenaltyKicks(jf.penalty_kicks as JfPenaltyKick[], lookup);
  await loadGroupStandings((jf.group_standings as JfGroupStanding[]).filter(s => isMens(s.tournament_id)));
  await loadAwardWinners((jf.award_winners as JfAwardWinner[]).filter(w => isMens(w.tournament_id)));

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
