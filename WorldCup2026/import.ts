// Script to import World Cup 2026 matches into Supabase
// Run with: npx tsx import.ts

import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

interface RawMatch {
  round: string;
  date: string;
  time: string;
  team1: string;
  team2: string;
  group?: string;
  ground?: string;
}

interface WorldCupData {
  matches: RawMatch[];
}

function parsePhase(round: string, group?: string): { phase: string; group_name: string | null } {
  if (group) {
    return { phase: 'grupos', group_name: group.replace('Group ', '') };
  }
  switch (round) {
    case 'Round of 32': return { phase: 'treintaidosavos', group_name: null };
    case 'Round of 16': return { phase: 'octavos', group_name: null };
    case 'Quarter-final': return { phase: 'cuartos', group_name: null };
    case 'Semi-final': return { phase: 'semis', group_name: null };
    case 'Match for third place': return { phase: 'tercer_lugar', group_name: null };
    case 'Final': return { phase: 'final', group_name: null };
    default: return { phase: round.toLowerCase(), group_name: null };
  }
}

function parseKickoff(date: string, time: string): string {
  // time format: "13:00 UTC-6"
  const [hhmm, utcOffset] = time.split(' ');
  const offsetHours = parseInt(utcOffset.replace('UTC', ''));
  const [hours, minutes] = hhmm.split(':').map(Number);

  // Build an ISO string with the offset
  const sign = offsetHours >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetHours);
  const offsetStr = `${sign}${String(absOffset).padStart(2, '0')}:00`;

  return `${date}T${hhmm}:00${offsetStr}`;
}

async function insertMatches(matches: Array<Record<string, unknown>>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/matches`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(matches),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Insert failed: ${res.status} ${text}`);
  }
}

async function main() {
  const dataPath = path.join(__dirname, 'worldcup.json');
  const data: WorldCupData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const matches = data.matches.map(m => {
    const { phase, group_name } = parsePhase(m.round, m.group);
    return {
      home_team: m.team1,
      away_team: m.team2,
      kickoff_at: parseKickoff(m.date, m.time),
      phase,
      group_name,
      status: 'scheduled',
    };
  });

  console.log(`Importing ${matches.length} matches...`);

  // Insert in batches of 50 to avoid request size limits
  const BATCH = 50;
  for (let i = 0; i < matches.length; i += BATCH) {
    const batch = matches.slice(i, i + BATCH);
    await insertMatches(batch);
    console.log(`  Inserted ${Math.min(i + BATCH, matches.length)}/${matches.length}`);
  }

  console.log('✅ Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
