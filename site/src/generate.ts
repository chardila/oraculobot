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
  telegram_id: number | null;
}

interface PredictionDetail {
  points: number | null;
  user_id: string;
  match_id: string;
  home_score?: number | null;
  away_score?: number | null;
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

export function layout(title: string, body: string, activePage: string = ''): string {
  const updated = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
  const navLink = (href: string, label: string, page: string) =>
    `<a href="${href}"${activePage === page ? ' class="active"' : ''}>${label}</a>`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — OraculoBot 2026</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    :root {
      --c-primary: #0070f3;
      --c-primary-dark: #005ecb;
      --c-primary-light: #e8f0fe;
      --c-text: #1a1a1a;
      --c-muted: #666;
      --c-bg: #f5f6f8;
      --c-surface: #ffffff;
      --c-border: #e5e5e5;
      --r-sm: 8px;
      --r-md: 12px;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
    }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 880px; margin: 0 auto; padding: 1rem; color: var(--c-text); background: var(--c-bg); }
    .surface { background: var(--c-surface); border-radius: var(--r-md); box-shadow: var(--shadow-sm); overflow: hidden; margin-bottom: 1rem; }
    nav { display: flex; gap: 0; padding: 0.75rem 1rem 0; border-bottom: 1px solid var(--c-border); }
    nav a { text-decoration: none; font-size: 0.875rem; font-weight: 500; color: var(--c-muted); padding: 0.4rem 0.6rem 0.6rem; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
    nav a:hover { color: var(--c-text); }
    nav a.active { color: var(--c-primary); font-weight: 600; border-bottom-color: var(--c-primary); }
    .surface-body { padding: 1rem 1.25rem 1.25rem; }
    h1 { font-size: 1.5rem; margin: 0.5rem 0 1rem; }
    h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
    .phase-header { font-size: 1.05rem; font-weight: 700; padding: 0.5rem 0.75rem; border-radius: var(--r-sm); margin: 0.5rem 0 0; display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none; }
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
    table { border-collapse: collapse; width: 100%; font-size: 0.88rem; background: var(--c-surface); border-radius: var(--r-sm); overflow: hidden; box-shadow: var(--shadow-sm); }
    th, td { text-align: left; padding: 0.55rem 0.75rem; }
    th { background: #f5f5f5; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--c-muted); }
    td { border-bottom: 1px solid var(--c-border); }
    tr:last-child td { border-bottom: none; }
    .match-finished { background: #fafafa; }
    .badge { font-size: 0.72rem; background: #f0f0f0; padding: 2px 10px; border-radius: 12px; color: #888; font-weight: 500; }
    .badge-finished { background: #e6f4ea; color: #1e7e34; }
    .result { font-weight: 700; font-size: 1rem; }
    .venue { font-size: 0.78rem; color: #888; }
    .time-col { white-space: nowrap; }
    footer { margin-top: 1.5rem; font-size: 0.75rem; color: #888; text-align: center; }
    .tz-note { font-size: 0.78rem; color: #999; margin: 0 0 0.75rem; text-align: right; }
    @media (max-width: 600px) {
      body { padding: 0.75rem; }
      thead { display: none; }
      table, tbody, tr { display: block; width: 100%; }
      tr { border: 1px solid var(--c-border); border-radius: 10px; margin-bottom: 0.75rem; padding: 0.6rem; background: var(--c-surface); box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
      td { border-bottom: none; padding: 0.3rem 0; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
      td::before { content: attr(data-label); font-weight: 600; color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.02em; flex-shrink: 0; }
      .match-finished td { background: transparent; }
      .result { font-size: 1.1rem; }
    }
  </style>
</head>
<body>
  <div class="surface">
    <nav>
      ${navLink('index.html', '🏆 Ranking', 'ranking')}
      ${navLink('partidos.html', '📅 Partidos', 'partidos')}
      ${navLink('stats.html', '📊 Stats', 'stats')}
      ${navLink('jugar.html', '🎯 Jugar', 'jugar')}
    </nav>
    <div class="surface-body">
  ${body}
    </div>
  </div>
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

export function generateIndex(): string {
  const SUPABASE_URL  = 'https://rhclzawbdxsitwtzdies.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_ia5yM6iARW7xUasAVGFFxA_nu6REkoU';
  const WORKER_URL    = 'https://oraculobot-worker.carlos-ardila-account.workers.dev';

  const script = `
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"><\/script>
    <script>
    (async () => {
      try {
        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const sb = supabase.createClient('${SUPABASE_URL}', '${SUPABASE_ANON}');
        const { data: { session } } = await sb.auth.getSession();
        const el = document.getElementById('ranking-container');
        if (!session) {
          el.innerHTML = '<p>Para ver el ranking, <a href="jugar.html">inicia sesión aquí<\/a>.</p>';
          return;
        }
        const res = await fetch('${WORKER_URL}/api/ranking', {
          headers: { 'Authorization': 'Bearer ' + session.access_token }
        });
        if (res.status === 401) {
          el.innerHTML = '<p>Sesión expirada. <a href="jugar.html">Inicia sesión de nuevo<\/a>.</p>';
          return;
        }
        if (!res.ok) { el.innerHTML = '<p>Error al cargar el ranking.</p>'; return; }
        const { league_name, ranking } = await res.json();
        const MEDALS = ['🥇', '🥈', '🥉'];
        const rows = ranking.map((r, i) =>
          '<tr><td>' + (MEDALS[i] ?? i + 1) + '</td><td>' + esc(r.username ?? 'Anónimo') + '</td><td><b>' + r.total_points + '</b></td><\/tr>'
        ).join('');
        el.innerHTML =
          '<h2>🏆 ' + esc(league_name ?? 'Ranking') + '</h2>' +
          '<table><thead><tr><th>#</th><th>Participante</th><th>Puntos</th></tr></thead>' +
          '<tbody>' + rows + '<\/tbody><\/table>';
      } catch (err) {
        console.error('ranking load error', err);
        document.getElementById('ranking-container').innerHTML = '<p>Error inesperado al cargar el ranking.</p>';
      }
    })();
    <\/script>`;

  return layout('Ranking', `
    <h1>🏆 Ranking — Mundial 2026</h1>
    <div id="ranking-container"><p>Cargando ranking...</p></div>
    ${script}
  `, 'ranking');
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
    return layout('Partidos', '<h1>📅 Partidos — Mundial 2026</h1><p>Sin partidos registrados.</p>', 'partidos');
  }

  return layout('Partidos', `
    <h1>📅 Partidos — Mundial 2026</h1>
    <div class="tz-note">🕐 Horarios en hora de Colombia (UTC-5)</div>
    ${groupByPhase(matches)}
  `, 'partidos');
}

export function generateStats(
  leaderboard: LeaderboardRow[],
  predictions: PredictionDetail[],
  matches: VenueMatch[]
): string {
  const COLORS = ['#0070f3', '#00c896', '#ff9800', '#e040fb', '#f44336'];
  const MEDALS = ['🥇', '🥈', '🥉'];

  const finishedMatches = matches
    .filter(m => m.status === 'finished')
    .sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime());
  const finishedCount = finishedMatches.length;
  const resolved = predictions.filter(p => p.points !== null);
  const total = resolved.length;
  const pct = (n: number) => total ? `${Math.round(n / total * 100)}%` : '—';

  const exact = resolved.filter(p => p.points === 5).length;
  const correct = resolved.filter(p => (p.points ?? 0) > 0 && (p.points ?? 0) < 5).length;
  const zero = resolved.filter(p => p.points === 0).length;

  const statsStyles = `<style>
    .stats-section{background:#fff;border-radius:12px;padding:1.25rem;margin-bottom:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.06);}
    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem;}
    .kpi{background:#f8f9fa;border-radius:10px;padding:.9rem .75rem;text-align:center;}
    .kpi-value{font-size:1.6rem;font-weight:800;line-height:1;color:#0070f3;}
    .kpi-green{color:#1e7e34;}.kpi-orange{color:#b96a00;}.kpi-red{color:#c62828;}
    .kpi-label{font-size:.72rem;color:#888;margin-top:.3rem;font-weight:500;text-transform:uppercase;letter-spacing:.04em;}
    .mini-bar{height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden;margin-bottom:2px;}
    .mini-bar-fill{height:100%;border-radius:4px;}
    .part-frac{font-size:.72rem;color:#888;}
    @media(max-width:600px){.kpi-grid{grid-template-columns:repeat(2,1fr);}}
    .consenso-card{border:1px solid #e5e5e5;border-radius:10px;padding:.9rem 1rem;margin-bottom:.75rem;background:#fafafa;}
    .consenso-match{font-weight:700;font-size:.95rem;margin-bottom:.35rem;}
    .consenso-popular{font-size:.87rem;color:#333;margin-bottom:.25rem;}
    .consenso-counts{font-size:.82rem;color:#555;gap:1rem;display:flex;flex-wrap:wrap;}
    .badge-sorpresa{background:#fff3e0;color:#b96a00;border-radius:8px;padding:1px 8px;font-size:.75rem;font-weight:600;margin-left:.4rem;}
  </style>`;

  const kpiSection = `
    <div class="stats-section">
      <h2>🌐 Resumen global</h2>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-value">${finishedCount}</div><div class="kpi-label">Partidos jugados</div></div>
        <div class="kpi"><div class="kpi-value kpi-green">${pct(exact)}</div><div class="kpi-label">🎯 Exactos (5 pts)</div></div>
        <div class="kpi"><div class="kpi-value kpi-orange">${pct(correct)}</div><div class="kpi-label">✔️ Con puntos (1–4 pts)</div></div>
        <div class="kpi"><div class="kpi-value kpi-red">${pct(zero)}</div><div class="kpi-label">❌ Sin puntos (0 pts)</div></div>
      </div>
    </div>`;

  // ── Sección 2: Gráfica de evolución ─────────────────────────────────
  const predMap = new Map<string, PredictionDetail>();
  for (const p of resolved) predMap.set(`${p.user_id}:${p.match_id}`, p);

  const chartLabels = finishedMatches.map((_, i) => `P${i + 1}`);
  const top5 = leaderboard.slice(0, COLORS.length);
  const rest = leaderboard.slice(COLORS.length);

  const buildDataset = (u: LeaderboardRow, color: string, borderWidth: number) => {
    let acc = 0;
    const data = finishedMatches.map(m => {
      const pred = predMap.get(`${u.user_id}:${m.id}`);
      acc += pred?.points ?? 0;
      return acc;
    });
    return { label: u.username ?? 'Anónimo', data, borderColor: color,
             backgroundColor: 'transparent', borderWidth, pointRadius: 0, tension: 0.3 };
  };

  const datasets = [
    ...top5.map((u, i) => buildDataset(u, COLORS[i], 2.5)),
    ...rest.map(u => buildDataset(u, '#e0e0e0', 1)),
  ];

  const chartJson = JSON.stringify({ labels: chartLabels, datasets })
    .replace(/<\//g, '<\\/');


  const chartSection = `
    <div class="stats-section">
      <h2>📈 Evolución de puntos acumulados</h2>
      <canvas id="evolution-chart" height="80"></canvas>
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
      <script>
        (function(){
          var ctx = document.getElementById('evolution-chart');
          new Chart(ctx, {
            type: 'line',
            data: ${chartJson},
            options: {
              responsive: true,
              interaction: { mode: 'index', intersect: false },
              plugins: { legend: { display: false } },
              scales: { y: { beginAtZero: true } }
            }
          });
        })();
      </script>
    </div>`;

  // ── Sección 3: Desglose por usuario ──────────────────────────────────
  const predByUser = new Map<string, PredictionDetail[]>();
  for (const p of resolved) {
    if (!predByUser.has(p.user_id)) predByUser.set(p.user_id, []);
    predByUser.get(p.user_id)!.push(p);
  }

  const userRows = leaderboard.map((u, i) => {
    const userPreds = predByUser.get(u.user_id) ?? [];
    const played = userPreds.length;
    const uExact = userPreds.filter(p => p.points === 5).length;
    const uCorrect = userPreds.filter(p => (p.points ?? 0) > 0 && (p.points ?? 0) < 5).length;
    const uZero = userPreds.filter(p => p.points === 0).length;
    const avg = played > 0 ? (Number(u.total_points) / played).toFixed(1) : '—';
    const pctPlayed = finishedCount > 0 ? Math.round(played / finishedCount * 100) : 0;
    const color = i < COLORS.length ? COLORS[i] : '#bbb';
    const pos = MEDALS[i] ?? String(i + 1);
    return `<tr>
      <td data-label="#">${pos}</td>
      <td data-label="Participante">${u.username ?? 'Anónimo'}</td>
      <td data-label="Pts"><b>${u.total_points}</b></td>
      <td data-label="🎯 Exactos">${uExact}</td>
      <td data-label="✔️ Correctos">${uCorrect}</td>
      <td data-label="❌ Ceros">${uZero}</td>
      <td data-label="Promedio">${avg}</td>
      <td data-label="Participación">
        <div class="mini-bar"><div class="mini-bar-fill" style="width:${pctPlayed}%;background:${color}"></div></div>
        <div class="part-frac">${played}/${finishedCount}</div>
      </td>
    </tr>`;
  }).join('');

  const userTable = leaderboard.length === 0 ? '' : `
    <div class="stats-section">
      <h2>👤 Desglose por participante</h2>
      <table>
        <thead><tr>
          <th>#</th><th>Participante</th><th>Pts</th>
          <th>🎯 Exactos</th><th>✔️ Correctos</th><th>❌ Ceros</th>
          <th>Promedio</th><th>Participación</th>
        </tr></thead>
        <tbody>${userRows}</tbody>
      </table>
    </div>`;

  // ── Sección 4: Dificultad de partidos ───────────────────────────────
  interface DiffEntry { m: VenueMatch; pct: number; total: number; }

  const predByMatch = new Map<string, PredictionDetail[]>();
  for (const p of resolved) {
    if (!predByMatch.has(p.match_id)) predByMatch.set(p.match_id, []);
    predByMatch.get(p.match_id)!.push(p);
  }

  const diffData: DiffEntry[] = finishedMatches
    .map(m => {
      const mp = predByMatch.get(m.id) ?? [];
      if (!mp.length) return null;
      const hits = mp.filter(p => (p.points ?? 0) >= 3).length;
      return { m, pct: Math.round(hits / mp.length * 100), total: mp.length };
    })
    .filter((x): x is DiffEntry => x !== null);

  const easiestCount = Math.min(3, Math.floor(diffData.length / 2));
  const easiest = easiestCount > 0
    ? [...diffData].sort((a, b) => b.pct - a.pct || b.total - a.total).slice(0, easiestCount)
    : [];
  const easiestIds = new Set(easiest.map(d => d.m.id));
  const hardest = [...diffData]
    .sort((a, b) => a.pct - b.pct || a.total - b.total)
    .filter(d => !easiestIds.has(d.m.id))
    .slice(0, 3);

  const diffRow = (d: DiffEntry, label: string, bg: string) =>
    `<tr style="background:${bg}">
      <td data-label="Partido">${d.m.home_team} vs ${d.m.away_team}</td>
      <td data-label="Fase">${d.m.phase}</td>
      <td data-label="Resultado">${d.m.home_score} – ${d.m.away_score}</td>
      <td data-label="% Aciertos"><b>${d.pct}%</b></td>
      <td>${label}</td>
    </tr>`;

  const diffRows = [
    ...easiest.map(d => diffRow(d, '😎 Fácil', '#f0faf3')),
    ...hardest.map(d => diffRow(d, '😱 Sorpresa', '#fef5f5')),
  ].join('');

  const diffTable = `
    <div class="stats-section">
      <h2>⚽ Partidos más y menos predecibles</h2>
      ${diffData.length === 0
        ? '<p>Sin partidos con predicciones aún.</p>'
        : `<table>
            <thead><tr><th>Partido</th><th>Fase</th><th>Resultado</th><th>% Aciertos</th><th></th></tr></thead>
            <tbody>${diffRows}</tbody>
          </table>`}
    </div>`;

  // ── Sección: Consenso por partido ─────────────────────────────────────────
  interface PredScore { home: number; away: number; count: number; }

  const scoresByMatch = new Map<string, Map<string, PredScore>>();
  for (const p of predictions) {
    if (p.home_score == null || p.away_score == null || p.points === null) continue;
    if (!scoresByMatch.has(p.match_id)) scoresByMatch.set(p.match_id, new Map());
    const key = `${p.home_score}-${p.away_score}`;
    const sm = scoresByMatch.get(p.match_id)!;
    if (!sm.has(key)) sm.set(key, { home: p.home_score, away: p.away_score, count: 0 });
    sm.get(key)!.count++;
  }

  const consensoCards = finishedMatches.map(m => {
    const sm = scoresByMatch.get(m.id);
    if (!sm?.size) return '';

    const popular = [...sm.values()].sort((a, b) => b.count - a.count)[0];
    const mp = predByMatch.get(m.id) ?? [];
    const uExactos  = mp.filter(p => p.points === 5).length;
    const uCorrec   = mp.filter(p => (p.points ?? 0) > 0 && (p.points ?? 0) < 5).length;
    const uCeros    = mp.filter(p => p.points === 0).length;
    const nadie     = uExactos === 0 && mp.length > 0;
    const personStr = popular.count === 1 ? 'persona' : 'personas';

    return `<div class="consenso-card">
    <div class="consenso-match">${m.home_team} ${m.home_score} – ${m.away_score} ${m.away_team}</div>
    <div class="consenso-popular">Predicción más popular: <b>${popular.home}-${popular.away}</b> (${popular.count} ${personStr})${nadie ? '<span class="badge-sorpresa">😱 Nadie lo vio venir</span>' : ''}</div>
    <div class="consenso-counts"><span>🎯 Exactos: ${uExactos}</span><span>✅ Correctos: ${uCorrec}</span><span>❌ Ceros: ${uCeros}</span></div>
  </div>`;
  }).filter(Boolean).join('');

  const consensoSection = finishedMatches.length === 0 ? '' : `
  <div class="stats-section">
    <h2>🗳️ Consenso por partido</h2>
    ${consensoCards || '<p>Sin predicciones aún.</p>'}
  </div>`;

  return layout('Estadísticas', `
    ${statsStyles}
    <h1>📊 Estadísticas — Mundial 2026</h1>
    ${kpiSection}
    ${consensoSection}
    ${chartSection}
    ${userTable}
    ${diffTable}
  `, 'stats');
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
    query<PredictionDetail[]>('predictions', { select: 'points,user_id,match_id,home_score,away_score' }),
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

  const adminTelegramId = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null;
  const leagueBoards = await Promise.all(
    leagues.map(async league => {
      const rows = await rpc<LeaderboardRow[]>('leaderboard', { p_league_id: league.id });
      const leaderboard = adminTelegramId
        ? rows.filter(r => r.telegram_id !== adminTelegramId)
        : rows;
      return { league, leaderboard };
    })
  );

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), generateIndex());
  fs.writeFileSync(path.join(OUT_DIR, 'partidos.html'), generatePartidos(enrichedMatches));
  const allLeaderboard = leagueBoards.flatMap(lb => lb.leaderboard);
  fs.writeFileSync(path.join(OUT_DIR, 'stats.html'), generateStats(allLeaderboard, predictions, enrichedMatches));

  const totalUsers = leagueBoards.reduce((s, lb) => s + lb.leaderboard.length, 0);
  console.log(`✅ Site generated in ${OUT_DIR}/ (${matches.length} matches, ${leagues.length} pollas, ${totalUsers} users)`);
}

// Only run when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
