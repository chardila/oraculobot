// Run with: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx WorldCup2026/backup.ts
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const TABLES = ['users', 'predictions', 'leagues', 'invite_codes'];
const PAGE_SIZE = 1000;

async function fetchAllRows(table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  let offset = 0;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=*`,
      {
        signal: AbortSignal.timeout(30_000),
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          Range: `${offset}-${offset + PAGE_SIZE - 1}`,
          'Range-Unit': 'items',
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch ${table}: ${res.status} ${await res.text()}`);
    }

    const page = (await res.json()) as unknown[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function main() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const outDir = path.join('backup-output', date);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Output directory: ${path.resolve(outDir)}`);

  for (const table of TABLES) {
    console.log(`Fetching ${table}...`);
    const rows = await fetchAllRows(table);
    const filePath = path.join(outDir, `${table}.json`);
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
    console.log(`  → ${rows.length} rows written to ${filePath}`);
  }

  console.log('Backup complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
