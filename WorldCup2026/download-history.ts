// WorldCup2026/download-history.ts
// Run with: npx tsx download-history.ts
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master';
const OUTPUT_DIR = join(__dirname, '..', 'worker', 'src', 'data', 'history');

const FILES = [
  { year: 2014, file: 'worldcup.json' },
  { year: 2014, file: 'worldcup.teams.json' },
  { year: 2014, file: 'worldcup.stadiums.json' },
  { year: 2014, file: 'worldcup.groups.json' },
  { year: 2014, file: 'worldcup.standings.json' },
  { year: 2018, file: 'worldcup.json' },
  { year: 2018, file: 'worldcup.teams.json' },
  { year: 2018, file: 'worldcup.stadiums.json' },
  { year: 2018, file: 'worldcup.groups.json' },
  { year: 2018, file: 'worldcup.standings.json' },
  { year: 2022, file: 'worldcup.json' },
  { year: 2022, file: 'worldcup.groups.json' },
  { year: 2026, file: 'worldcup.json' },
  { year: 2026, file: 'worldcup.teams_meta.json' },
  { year: 2026, file: 'worldcup.stadiums.json' },
];

async function download() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const { year, file } of FILES) {
    const url = `${BASE_URL}/${year}/${file}`;
    process.stdout.write(`Downloading ${year}/${file}... `);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`FAILED (${res.status})`);
      continue;
    }
    const data = await res.text();
    const outFile = `${year}-${file}`;
    writeFileSync(join(OUTPUT_DIR, outFile), data);
    console.log(`OK (${data.length} bytes)`);
  }

  console.log(`\nDone. Files saved to worker/src/data/history/`);
}

download().catch(console.error);
