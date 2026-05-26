import type { SupabaseClient } from '../supabase';

export type BracketEntry = {
  nextMatchNum: number;
  as: 'home' | 'away';
  qualifier: 'winner' | 'loser';
};

const BRACKET_MAP: Record<number, BracketEntry[]> = {
  // Round of 32 → Round of 16
  73:  [{ nextMatchNum: 90,  as: 'home', qualifier: 'winner' }],
  74:  [{ nextMatchNum: 89,  as: 'home', qualifier: 'winner' }],
  75:  [{ nextMatchNum: 90,  as: 'away', qualifier: 'winner' }],
  76:  [{ nextMatchNum: 91,  as: 'home', qualifier: 'winner' }],
  77:  [{ nextMatchNum: 89,  as: 'away', qualifier: 'winner' }],
  78:  [{ nextMatchNum: 91,  as: 'away', qualifier: 'winner' }],
  79:  [{ nextMatchNum: 92,  as: 'home', qualifier: 'winner' }],
  80:  [{ nextMatchNum: 92,  as: 'away', qualifier: 'winner' }],
  81:  [{ nextMatchNum: 94,  as: 'home', qualifier: 'winner' }],
  82:  [{ nextMatchNum: 94,  as: 'away', qualifier: 'winner' }],
  83:  [{ nextMatchNum: 93,  as: 'home', qualifier: 'winner' }],
  84:  [{ nextMatchNum: 93,  as: 'away', qualifier: 'winner' }],
  85:  [{ nextMatchNum: 96,  as: 'home', qualifier: 'winner' }],
  86:  [{ nextMatchNum: 95,  as: 'home', qualifier: 'winner' }],
  87:  [{ nextMatchNum: 96,  as: 'away', qualifier: 'winner' }],
  88:  [{ nextMatchNum: 95,  as: 'away', qualifier: 'winner' }],
  // Round of 16 → Quarters
  89:  [{ nextMatchNum: 97,  as: 'home', qualifier: 'winner' }],
  90:  [{ nextMatchNum: 97,  as: 'away', qualifier: 'winner' }],
  91:  [{ nextMatchNum: 99,  as: 'home', qualifier: 'winner' }],
  92:  [{ nextMatchNum: 99,  as: 'away', qualifier: 'winner' }],
  93:  [{ nextMatchNum: 98,  as: 'home', qualifier: 'winner' }],
  94:  [{ nextMatchNum: 98,  as: 'away', qualifier: 'winner' }],
  95:  [{ nextMatchNum: 100, as: 'home', qualifier: 'winner' }],
  96:  [{ nextMatchNum: 100, as: 'away', qualifier: 'winner' }],
  // Quarters → Semis
  97:  [{ nextMatchNum: 101, as: 'home', qualifier: 'winner' }],
  98:  [{ nextMatchNum: 101, as: 'away', qualifier: 'winner' }],
  99:  [{ nextMatchNum: 102, as: 'home', qualifier: 'winner' }],
  100: [{ nextMatchNum: 102, as: 'away', qualifier: 'winner' }],
  // Semis → Final + Third place
  101: [
    { nextMatchNum: 104, as: 'home', qualifier: 'winner' },
    { nextMatchNum: 103, as: 'home', qualifier: 'loser'  },
  ],
  102: [
    { nextMatchNum: 104, as: 'away', qualifier: 'winner' },
    { nextMatchNum: 103, as: 'away', qualifier: 'loser'  },
  ],
};

export function getBracketEntries(matchNum: number | null): BracketEntry[] {
  if (matchNum === null) return [];
  return BRACKET_MAP[matchNum] ?? [];
}

export function resolveTeam(
  match: { home_team: string; away_team: string },
  winner: 'home' | 'away',
  qualifier: 'winner' | 'loser'
): string {
  const winnerTeam = winner === 'home' ? match.home_team : match.away_team;
  const loserTeam  = winner === 'home' ? match.away_team : match.home_team;
  return qualifier === 'winner' ? winnerTeam : loserTeam;
}

export async function propagateBracket(
  match: { match_num: number | null; home_team: string; away_team: string },
  winner: 'home' | 'away',
  db: SupabaseClient
): Promise<void> {
  const entries = getBracketEntries(match.match_num);
  await Promise.all(entries.map(async entry => {
    const team = resolveTeam(match, winner, entry.qualifier);
    const target = await db.getMatchByNum(entry.nextMatchNum);
    if (target) {
      await db.updateMatchTeam(target.id, entry.as, team);
    }
  }));
}
