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
}

interface LeaderboardRow {
  user_id: string;
  username: string | null;
  total_points: number;
}

interface Prediction {
  points: number | null;
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

async function rpc<T>(fn: string): Promise<T> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
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
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 1rem; color: #1a1a1a; }
    nav { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    nav a { text-decoration: none; color: #0070f3; font-weight: 500; }
    nav a:hover { text-decoration: underline; }
    h1 { font-size: 1.5rem; margin: 0.5rem 0 1rem; }
    h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e5e5; }
    th { background: #f8f8f8; font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    .badge { font-size: 0.75rem; background: #f0f0f0; padding: 2px 8px; border-radius: 12px; }
    .result { font-weight: 700; }
    footer { margin-top: 2rem; font-size: 0.75rem; color: #888; }
    @media (max-width: 480px) {
      thead { display: none }
      table, tbody, tr { display: block; width: 100%; }
      tr { border: 1px solid #e5e5e5; border-radius: 8px; margin-bottom: 0.75rem; padding: 0.5rem; }
      td { border-bottom: none; padding: 0.25rem 0.5rem; display: flex; justify-content: space-between; align-items: center; }
      td::before { content: attr(data-label); font-weight: 600; color: #555; margin-right: 0.5rem; flex-shrink: 0; }
    }
  </style>
</head>
<body>
  <nav>
    <a href="index.html">🏆 Ranking</a>
    <a href="partidos.html">📅 Partidos</a>
    <a href="stats.html">📊 Stats</a>
  </nav>
  ${body}
  <footer>Actualizado: ${updated}</footer>
</body>
</html>`;
}

export function generateIndex(leaderboard: LeaderboardRow[]): string {
  const MEDALS = ['🥇', '🥈', '🥉'];
  const rows = leaderboard.length === 0
    ? '<tr><td colspan="3">Sin puntos registrados aún.</td></tr>'
    : leaderboard.map((r, i) =>
        `<tr><td data-label="#">${MEDALS[i] ?? i + 1}</td><td data-label="Participante">${r.username ?? 'Anónimo'}</td><td data-label="Puntos"><b>${r.total_points}</b></td></tr>`
      ).join('');

  return layout('Ranking', `
    <h1>🏆 Ranking — Mundial 2026</h1>
    <table>
      <thead><tr><th>#</th><th>Participante</th><th>Puntos</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

export function generatePartidos(matches: Match[]): string {
  const rows = matches.length === 0
    ? '<tr><td colspan="5">Sin partidos registrados.</td></tr>'
    : matches.map(m => {
        const result = m.status === 'finished'
          ? `<span class="result">${m.home_score} - ${m.away_score}</span>`
          : `<span class="badge">Pendiente</span>`;
        const phase = m.group_name ? `Grupo ${m.group_name}` : m.phase;
        return `<tr>
  <td data-label="Local">${m.home_team}</td>
  <td data-label="Resultado">${result}</td>
  <td data-label="Visitante">${m.away_team}</td>
  <td data-label="Fecha">${formatDate(m.kickoff_at)}</td>
  <td data-label="Fase">${phase}</td>
</tr>`;
      }).join('');

  return layout('Partidos', `
    <h1>📅 Partidos — Mundial 2026</h1>
    <table>
      <thead><tr><th>Local</th><th>Resultado</th><th>Visitante</th><th>Fecha</th><th>Fase</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
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
  const [leaderboard, matches, predictions] = await Promise.all([
    rpc<LeaderboardRow[]>('leaderboard'),
    query<Match[]>('matches', { order: 'kickoff_at.asc' }),
    query<Prediction[]>('predictions', { select: 'points' }),
  ]);

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), generateIndex(leaderboard));
  fs.writeFileSync(path.join(OUT_DIR, 'partidos.html'), generatePartidos(matches));
  fs.writeFileSync(path.join(OUT_DIR, 'stats.html'), generateStats(leaderboard, predictions));

  console.log(`✅ Site generated in ${OUT_DIR}/ (${matches.length} matches, ${leaderboard.length} users)`);
}

// Only run when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
