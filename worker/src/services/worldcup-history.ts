/**
 * Static historical World Cup context (2014–2026) for DeepSeek system prompts.
 * Data bundled at module load time from JSON files in worker/src/data/history/.
 * Downloaded once via WorldCup2026/download-history.ts and committed to the repo.
 * 2022 standings/teams data intentionally absent — not published in openfootball for 2022.
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

export const HISTORY_CONTEXT =
  `=== MUNDIAL 2014 ===\n` +
  `Grupos: ${JSON.stringify(groups2014)}\n` +
  `Tabla final de grupos: ${JSON.stringify(standings2014)}\n` +
  `Equipos: ${JSON.stringify(teams2014)}\n` +
  `Partidos y goles: ${JSON.stringify(wc2014)}\n` +
  `Estadios: ${JSON.stringify(stadiums2014)}\n\n` +
  `=== MUNDIAL 2018 ===\n` +
  `Grupos: ${JSON.stringify(groups2018)}\n` +
  `Tabla final de grupos: ${JSON.stringify(standings2018)}\n` +
  `Equipos: ${JSON.stringify(teams2018)}\n` +
  `Partidos y goles: ${JSON.stringify(wc2018)}\n` +
  `Estadios: ${JSON.stringify(stadiums2018)}\n\n` +
  `=== MUNDIAL 2022 ===\n` +
  `Grupos: ${JSON.stringify(groups2022)}\n` +
  `Partidos y goles: ${JSON.stringify(wc2022)}\n` +
  `Estadios: ${JSON.stringify(stadiums2022)}\n\n` +
  `=== MUNDIAL 2026 - Equipos, Estadios y Bracket ===\n` +
  `Equipos y confederaciones: ${JSON.stringify(teams2026)}\n` +
  `Estadios sede: ${JSON.stringify(stadiums2026)}\n` +
  `Bracket eliminatorias: ${JSON.stringify(wc2026bracket)}`;
