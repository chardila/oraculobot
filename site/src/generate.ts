import * as fs from 'fs';
import * as path from 'path';

const OUT_DIR = process.env.OUT_DIR ?? 'dist';

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  phase: string;
  group_name: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  ground: string | null;
}

interface VenueMatch {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  phase: string;
  group_name: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  ground: string;
  name: string;
  city: string;
  country: string;
}

interface League {
  id: string;
  name: string;
}

interface LeaderboardRow {
  user_id: string;
  username: string | null;
  total_points: number;
}

interface Prediction {
  points: number | null;
}

const VENUE_MAP: Record<string, { name: string; city: string; country: string }> = {
  'Atlanta':                      { name: 'Mercedes-Benz Stadium', city: 'Atlanta', country: '🇺🇸' },
  'Boston (Foxborough)':          { name: 'Gillette Stadium', city: 'Foxborough', country: '🇺🇸' },
  'Dallas (Arlington)':           { name: 'AT&T Stadium', city: 'Arlington', country: '🇺🇸' },
  'Guadalajara (Zapopan)':        { name: 'Estadio Akron', city: 'Guadalajara', country: '🇲🇽' },
  'Houston':                      { name: 'NRG Stadium', city: 'Houston', country: '🇺🇸' },
  'Kansas City':                  { name: 'Arrowhead Stadium', city: 'Kansas City', country: '🇺🇸' },
  'Los Angeles (Inglewood)':      { name: 'SoFi Stadium', city: 'Inglewood', country: '🇺🇸' },
  'Mexico City':                  { name: 'Estadio Azteca', city: 'Ciudad de México', country: '🇲🇽' },
  'Miami (Miami Gardens)':        { name: 'Hard Rock Stadium', city: 'Miami Gardens', country: '🇺🇸' },
  'Monterrey (Guadalupe)':        { name: 'Estadio BBVA', city: 'Monterrey', country: '🇲🇽' },
  'New York/New Jersey (East Rutherford)': { name: 'MetLife Stadium', city: 'East Rutherford', country: '🇺🇸' },
  'Philadelphia':                 { name: 'Lincoln Financial Field', city: 'Filadelfia', country: '🇺🇸' },
  'San Francisco Bay Area (Santa Clara)': { name: "Levi's Stadium", city: 'Santa Clara', country: '🇺🇸' },
  'Seattle':                      { name: 'Lumen Field', city: 'Seattle', country: '🇺🇸' },
  'Toronto':                      { name: 'BMO Field', city: 'Toronto', country: '🇨🇦' },
  'Vancouver':                    { name: 'BC Place', city: 'Vancouver', country: '🇨🇦' },
};

function getVenue(ground: string): { name: string; city: string; country: string } {
  return VENUE_MAP[ground] ?? { name: ground, city: ground, country: '' };
}

async function query<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;
  const url = new URL(`${supabaseUrl}/rest/v1/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function rpc<T>(fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase rpc/${fn}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Bogota',
  });
}

function enrichMatch(m: Match, groundLookup: Map<string, string>): VenueMatch {
  const dbGround = m.ground;
  const jsonGround = groundLookup.get(`${m.home_team}\x00${m.away_team}`);
  const ground = dbGround ?? jsonGround ?? '';
  const venue = getVenue(ground);
  return { ...m, ground, ...venue };
}

export function layout(title: string, body: string): string {
  const updated = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — OraculoBot 2026</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 880px; margin: 0 auto; padding: 1rem; color: #1a1a1a; background: #fafafa; }
    nav { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    nav a { text-decoration: none; color: #0070f3; font-weight: 500; padding: 0.25rem 0; }
    nav a:hover { text-decoration: underline; }
    h1 { font-size: 1.5rem; margin: 0.5rem 0 1rem; }
    h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
    .phase-header { font-size: 1.05rem; font-weight: 700; padding: 0.5rem 0.75rem; border-radius: 8px; margin: 0.5rem 0 0; display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none; }
    .phase-header:hover { filter: brightness(0.96); }
    .phase-header.grupos { background: #e8f4fd; color: #1a5a8c; }
    .phase-header.eliminatorias { background: #fef3e2; color: #8c6a1a; }
    .phase-header.final { background: #fff0e0; color: #b3470a; }
    .phase-header .arrow { margin-left: auto; font-size: 0.85rem; transition: transform 0.2s; }
    .phase-header.open .arrow { transform: rotate(180deg); }
    .phase-content { overflow: hidden; max-height: 0; transition: max-height 0.3s ease; }
    .phase-content.open { max-height: none; }
    .group-label { font-size: 0.85rem; font-weight: 600; color: #555; padding: 0.4rem 0.75rem; margin: 0.5rem 0 0; background: #f0f0f0; border-radius: 6px; display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none; }
    .group-label:hover { background: #e5e5e5; }
    .group-label .arrow { margin-left: auto; font-size: 0.75rem; transition: transform 0.2s; }
    .group-label.open .arrow { transform: rotate(180deg); }
    .group-content { overflow: hidden; max-height: 0; transition: max-height 0.2s ease; }
    .group-content.open { max-height: none; }
    table { border-collapse: collapse; width: 100%; font-size: 0.88rem; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    th, td { text-align: left; padding: 0.55rem 0.75rem; }
    th { background: #f5f5f5; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: #666; }
    td { border-bottom: 1px solid #eee; }
    tr:last-child td { border-bottom: none; }
    .match-finished { background: #fafafa; }
    .badge { font-size: 0.72rem; background: #f0f0f0; padding: 2px 10px; border-radius: 12px; color: #888; font-weight: 500; }
    .badge-finished { background: #e6f4ea; color: #1e7e34; }
    .result { font-weight: 700; font-size: 1rem; }
    .venue { font-size: 0.78rem; color: #888; }
    .time-col { white-space: nowrap; }
    footer { margin-top: 2rem; font-size: 0.75rem; color: #888; text-align: center; }
    .tz-note { font-size: 0.78rem; color: #999; margin: 0 0 0.75rem; text-align: right; }
    @media (max-width: 600px) {
      body { padding: 0.75rem; }
      thead { display: none; }
      table, tbody, tr { display: block; width: 100%; }
      tr { border: 1px solid #e5e5e5; border-radius: 10px; margin-bottom: 0.75rem; padding: 0.6rem; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
      td { border-bottom: none; padding: 0.3rem 0; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
      td::before { content: attr(data-label); font-weight: 600; color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.02em; flex-shrink: 0; }
      .match-finished td { background: transparent; }
      .result { font-size: 1.1rem; }
    }
  </style>
</head>
<body>
  <nav>
    <a href="index.html">🏆 Ranking</a>
    <a href="partidos.html">📅 Partidos</a>
    <a href="stats.html">📊 Stats</a>
    <a href="jugar.html">🎯 Jugar</a>
  </nav>
  ${body}
  <footer>Actualizado: ${updated}</footer>
  <script>
    function togglePhase(header) {
      header.classList.toggle('open');
      const content = header.nextElementSibling;
      if (content) content.classList.toggle('open');
    }
  </script>
</body>
</html>`;
}

export function generateIndex(leagues: Array<{ league: League; leaderboard: LeaderboardRow[] }>): string {
  const MEDALS = ['🥇', '🥈', '🥉'];

  const sections = leagues.map(({ league, leaderboard }) => {
    const rows = leaderboard.length === 0
      ? '<tr><td colspan="3">Sin puntos registrados aún.</td></tr>'
      : leaderboard.map((r, i) =>
          `<tr><td data-label="#">${MEDALS[i] ?? i + 1}</td><td data-label="Participante">${r.username ?? 'Anónimo'}</td><td data-label="Puntos"><b>${r.total_points}</b></td></tr>`
        ).join('');

    return `
      <h2>🏆 ${league.name}</h2>
      <table>
        <thead><tr><th>#</th><th>Participante</th><th>Puntos</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  return layout('Ranking', `<h1>🏆 Ranking — Mundial 2026</h1>${sections}`);
}

const PHASE_ORDER = ['grupos', 'treintaidosavos', 'octavos', 'cuartos', 'semis', 'tercer_lugar', 'final'];
const PHASE_LABELS: Record<string, string> = {
  grupos: 'Fase de Grupos',
  treintaidosavos: 'Treintaidosavos de Final',
  octavos: 'Octavos de Final',
  cuartos: 'Cuartos de Final',
  semis: 'Semifinales',
  tercer_lugar: 'Tercer Puesto',
  final: 'Gran Final',
};
const PHASE_ICONS: Record<string, string> = {
  grupos: '🌍',
  treintaidosavos: '⚔️',
  octavos: '⚔️',
  cuartos: '🏟️',
  semis: '🔥',
  tercer_lugar: '🥉',
  final: '🏆',
};

function matchRow(m: VenueMatch): string {
  const isFinished = m.status === 'finished';
  const result = isFinished
    ? `<span class="result">${m.home_score} - ${m.away_score}</span>`
    : `<span class="badge">Pendiente</span>`;
  const cssClass = isFinished ? ' class="match-finished"' : '';
  const venueStr = m.country ? `${m.name}, ${m.city} ${m.country}` : m.ground;

  return `<tr${cssClass}>
  <td data-label="Local">${m.home_team}</td>
  <td data-label="Resultado">${result}</td>
  <td data-label="Visitante">${m.away_team}</td>
  <td data-label="Fecha" class="time-col">${formatDate(m.kickoff_at)}</td>
  <td data-label="Sede"><span class="venue">${venueStr}</span></td>
</tr>`;
}

function groupByGroup(matches: VenueMatch[]): string {
  const groups = new Map<string, VenueMatch[]>();
  for (const m of matches) {
    const g = m.group_name ?? '?';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(m);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, ms]) =>
      `<div class="group-label" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open')">Grupo ${group}<span class="arrow">▾</span></div>
      <div class="group-content">
        <table>
          <thead><tr><th>Local</th><th>Resultado</th><th>Visitante</th><th>Hora Colombia</th><th>Sede</th></tr></thead>
          <tbody>${ms.map(matchRow).join('')}</tbody>
        </table>
      </div>`
    ).join('');
}

function groupByPhase(matches: VenueMatch[]): string {
  const phases = new Map<string, VenueMatch[]>();
  for (const m of matches) {
    if (!phases.has(m.phase)) phases.set(m.phase, []);
    phases.get(m.phase)!.push(m);
  }

  return PHASE_ORDER
    .filter(p => phases.has(p))
    .map(phase => {
      const ms = phases.get(phase)!;
      const icon = PHASE_ICONS[phase] ?? '';
      const label = PHASE_LABELS[phase] ?? phase;
      const cssClass = phase === 'grupos' ? 'grupos' : phase === 'final' ? 'final' : 'eliminatorias';
      const open = '';

      let content: string;
      if (phase === 'grupos') {
        content = groupByGroup(ms);
      } else {
        content = `<table>
          <thead><tr><th>Local</th><th>Resultado</th><th>Visitante</th><th>Hora Colombia</th><th>Sede</th></tr></thead>
          <tbody>${ms.map(matchRow).join('')}</tbody>
        </table>`;
      }

      return `<div class="phase-header ${cssClass}${open}" onclick="togglePhase(this)">${icon} ${label}<span class="arrow">▾</span></div><div class="phase-content${open}">${content}</div>`;
    }).join('');
}

export function generatePartidos(matches: VenueMatch[]): string {
  if (matches.length === 0) {
    return layout('Partidos', '<h1>📅 Partidos — Mundial 2026</h1><p>Sin partidos registrados.</p>');
  }

  return layout('Partidos', `
    <h1>📅 Partidos — Mundial 2026</h1>
    <div class="tz-note">🕐 Horarios en hora de Colombia (UTC-5)</div>
    ${groupByPhase(matches)}
  `);
}

export function generateStats(leaderboard: LeaderboardRow[], predictions: Prediction[]): string {
  const resolved = predictions.filter(p => p.points !== null);
  const total = resolved.length;
  const exact = resolved.filter(p => p.points === 5).length;
  const correct = resolved.filter(p => p.points !== null && p.points >= 3 && p.points < 5).length;
  const bonus = resolved.filter(p => p.points === 4).length;
  const zero = resolved.filter(p => p.points === 0).length;
  const pct = (n: number) => total ? `${Math.round(n / total * 100)}%` : '—';

  const leader = leaderboard[0];

  return layout('Estadísticas', `
    <h1>📊 Estadísticas</h1>
    <h2>Líder actual</h2>
    <p>${leader ? `<b>${leader.username ?? 'Anónimo'}</b> con <b>${leader.total_points} pts</b>` : 'Sin datos aún.'}</p>
    <h2>Predicciones resueltas: ${total}</h2>
    <table>
      <thead><tr><th>Resultado</th><th>Cantidad</th><th>%</th></tr></thead>
      <tbody>
        <tr><td data-label="Resultado">🎯 Marcador exacto (5pts)</td><td data-label="Cantidad">${exact}</td><td data-label="%">${pct(exact)}</td></tr>
        <tr><td data-label="Resultado">✔️ Resultado + diferencia (4pts)</td><td data-label="Cantidad">${bonus}</td><td data-label="%">${pct(bonus)}</td></tr>
        <tr><td data-label="Resultado">✔️ Solo resultado (3pts)</td><td data-label="Cantidad">${correct - bonus}</td><td data-label="%">${pct(correct - bonus)}</td></tr>
        <tr><td data-label="Resultado">❌ Sin puntos (0pts)</td><td data-label="Cantidad">${zero}</td><td data-label="%">${pct(zero)}</td></tr>
      </tbody>
    </table>
  `);
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Querying Supabase...');
  const [leagues, matches, predictions] = await Promise.all([
    query<League[]>('leagues', { order: 'created_at.asc', select: 'id,name' }),
    query<Match[]>('matches', { order: 'kickoff_at.asc' }),
    query<Prediction[]>('predictions', { select: 'points' }),
  ]);

  // Build ground lookup from worldcup.json (for backfill until DB has ground column)
  const wcPath = path.join(__dirname, '..', '..', 'WorldCup2026', 'worldcup.json');
  const groundLookup = new Map<string, string>();
  if (fs.existsSync(wcPath)) {
    const wcData = JSON.parse(fs.readFileSync(wcPath, 'utf-8'));
    for (const m of wcData.matches) {
      groundLookup.set(`${m.team1}\x00${m.team2}`, m.ground ?? '');
    }
  }

  const enrichedMatches: VenueMatch[] = matches.map(m => enrichMatch(m, groundLookup));

  const leagueBoards = await Promise.all(
    leagues.map(async league => ({
      league,
      leaderboard: await rpc<LeaderboardRow[]>('leaderboard', { p_league_id: league.id }),
    }))
  );

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), generateIndex(leagueBoards));
  fs.writeFileSync(path.join(OUT_DIR, 'partidos.html'), generatePartidos(enrichedMatches));
  const allLeaderboard = leagueBoards.flatMap(lb => lb.leaderboard);
  fs.writeFileSync(path.join(OUT_DIR, 'stats.html'), generateStats(allLeaderboard, predictions));

  const totalUsers = leagueBoards.reduce((s, lb) => s + lb.leaderboard.length, 0);
  console.log(`✅ Site generated in ${OUT_DIR}/ (${matches.length} matches, ${leagues.length} pollas, ${totalUsers} users)`);
}

// Only run when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
