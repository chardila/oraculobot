/**
 * Static historical World Cup context (2014–2026) for DeepSeek system prompts.
 * Data bundled at module load time from JSON files in worker/src/data/history/.
 * Downloaded once via WorldCup2026/download-history.ts and committed to the repo.
 * 2022 standings/teams data intentionally absent — not published in openfootball for 2022.
 *
 * Context is formatted as compact text (not raw JSON) to minimize token usage (~77% reduction).
 */
import wc2014 from '../data/history/2014-worldcup.json';
import teams2014 from '../data/history/2014-worldcup.teams.json';
import stadiums2014 from '../data/history/2014-worldcup.stadiums.json';
import groups2014 from '../data/history/2014-worldcup.groups.json';
import standings2014 from '../data/history/2014-worldcup.standings.json';
import wc2018 from '../data/history/2018-worldcup.json';
import teams2018 from '../data/history/2018-worldcup.teams.json';
import stadiums2018 from '../data/history/2018-worldcup.stadiums.json';
import groups2018 from '../data/history/2018-worldcup.groups.json';
import standings2018 from '../data/history/2018-worldcup.standings.json';
import wc2022 from '../data/history/2022-worldcup.json';
import groups2022 from '../data/history/2022-worldcup.groups.json';
import stadiums2022 from '../data/history/2022-worldcup.stadiums.json';
import wc2026bracket from '../data/history/2026-worldcup.json';
import teams2026 from '../data/history/2026-worldcup.teams_meta.json';
import stadiums2026 from '../data/history/2026-worldcup.stadiums.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fmtGoal(g: any): string {
  return g.name
    + (g.minute != null ? '/' + g.minute : '')
    + (g.penalty ? 'p' : '')
    + (g.owngoal ? '(og)' : '');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fmtMatches(matches: any[]): string {
  return matches.map(m => {
    const score = m.score ? m.score.ft[0] + '-' + m.score.ft[1] : 'vs';
    const ht = m.score?.ht ? ' HT:' + m.score.ht[0] + '-' + m.score.ht[1] : '';
    const g1 = (m.goals1 ?? []).map(fmtGoal).join(',');
    const g2 = (m.goals2 ?? []).map(fmtGoal).join(',');
    const goals = [g1 && 'L:' + g1, g2 && 'V:' + g2].filter(Boolean).join(' ');
    const loc = m.group ?? m.round;
    return `${m.team1} ${score}${ht} ${m.team2} [${loc}]${goals ? ' ' + goals : ''}`;
  }).join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fmtGroups(groups: any[]): string {
  return groups.map(g =>
    g.name + ': ' + g.teams.map((t: any) => typeof t === 'string' ? t : t.name).join(', ')
  ).join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fmtStandings(groups: any[]): string {
  return groups.map(g =>
    g.name + ': ' + g.standings.map((s: any) => `${s.team.name} ${s.pts}pts`).join(', ')
  ).join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fmtTeamsHist(teams: any[]): string {
  return teams.map(t => `${t.name} (${t.code}, ${t.continent})`).join('; ');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fmtStadiumsHist(stadiums: any[]): string {
  return stadiums.map(s => `${s.name} (${s.city}, cap:${s.capacity ?? s.cap})`).join('; ');
}

export const HISTORY_CONTEXT =
  `=== MUNDIAL 2014 ===\n` +
  `Grupos:\n${fmtGroups((groups2014 as any).groups)}\n` +
  `Tabla final:\n${fmtStandings((standings2014 as any).groups)}\n` +
  `Equipos: ${fmtTeamsHist((teams2014 as any).teams)}\n` +
  `Estadios: ${fmtStadiumsHist((stadiums2014 as any).stadiums)}\n` +
  `Partidos:\n${fmtMatches((wc2014 as any).matches)}\n\n` +
  `=== MUNDIAL 2018 ===\n` +
  `Grupos:\n${fmtGroups((groups2018 as any).groups)}\n` +
  `Tabla final:\n${fmtStandings((standings2018 as any).groups)}\n` +
  `Equipos: ${fmtTeamsHist((teams2018 as any).teams)}\n` +
  `Estadios: ${fmtStadiumsHist((stadiums2018 as any).stadiums)}\n` +
  `Partidos:\n${fmtMatches((wc2018 as any).matches)}\n\n` +
  `=== MUNDIAL 2022 ===\n` +
  `Grupos:\n${fmtGroups((groups2022 as any).groups)}\n` +
  `Estadios: ${fmtStadiumsHist((stadiums2022 as any).stadiums)}\n` +
  `Partidos:\n${fmtMatches((wc2022 as any).matches)}\n\n` +
  `=== MUNDIAL 2026 ===\n` +
  `Equipos: ${(teams2026 as any[]).map(t => `${t.name} (${t.fifa_code}, ${t.confed}, Grupo ${t.group})`).join('; ')}\n` +
  `Estadios: ${fmtStadiumsHist(stadiums2026 as any)}\n` +
  `Bracket:\n${fmtMatches((wc2026bracket as any).matches)}`;
