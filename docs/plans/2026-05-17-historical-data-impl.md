# Historical Data Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Descargar datos históricos de Mundiales 2014–2026 de openfootball e inyectarlos en el system prompt de DeepSeek para responder preguntas históricas.

**Architecture:** Script one-shot descarga los JSON de openfootball y los guarda en `worker/src/data/history/`. Un nuevo servicio `worldcup-history.ts` los importa y exporta un string de contexto. `question.ts` lo agrega al system prompt junto con el `VENUE_CONTEXT` que ya existe pero no se está usando.

**Tech Stack:** TypeScript, tsx (runner), Cloudflare Workers, Wrangler (esbuild), DeepSeek API.

---

### Task 1: Crear script de descarga

**Files:**
- Create: `WorldCup2026/download-history.ts`

**Step 1: Crear el script**

```typescript
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
```

**Step 2: Ejecutar el script**

```bash
cd WorldCup2026 && npx tsx download-history.ts
```

Expected: 15 líneas "OK (N bytes)", sin ningún "FAILED".

**Step 3: Verificar que los archivos existen**

```bash
ls worker/src/data/history/
```

Expected: 15 archivos `.json` (2014-worldcup.json, 2014-worldcup.teams.json, ..., 2026-worldcup.stadiums.json)

**Step 4: Commit script y datos**

```bash
rtk git add WorldCup2026/download-history.ts worker/src/data/history/
rtk git commit -m "feat: add openfootball historical data 2014-2026"
```

---

### Task 2: Crear servicio worldcup-history.ts

**Files:**
- Create: `worker/src/services/worldcup-history.ts`
- Maybe modify: `worker/tsconfig.json` (si hay errores de TypeScript con JSON imports)

**Step 1: Crear el servicio**

```typescript
// worker/src/services/worldcup-history.ts
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
  `Partidos y goles: ${JSON.stringify(wc2022)}\n\n` +
  `=== MUNDIAL 2026 - Equipos, Estadios y Bracket ===\n` +
  `Equipos y confederaciones: ${JSON.stringify(teams2026)}\n` +
  `Estadios sede: ${JSON.stringify(stadiums2026)}\n` +
  `Bracket eliminatorias: ${JSON.stringify(wc2026bracket)}`;
```

**Step 2: Verificar que TypeScript no tiene errores**

```bash
cd worker && npx tsc --noEmit
```

Si hay error `Cannot find module '*.json'`, agregar `"resolveJsonModule": true` en `worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

Volver a correr `npx tsc --noEmit` y confirmar: sin errores.

**Step 3: Commit**

```bash
rtk git add worker/src/services/worldcup-history.ts worker/tsconfig.json
rtk git commit -m "feat: add worldcup-history service with 2014-2026 data"
```

---

### Task 3: Integrar en question.ts

**Files:**
- Modify: `worker/src/handlers/web/question.ts`

El archivo actualmente importa desde `../../services/deepseek` y otros, pero NO importa `VENUE_CONTEXT` ni `HISTORY_CONTEXT`. Hay que agregar ambos imports y extender el system prompt.

**Step 1: Agregar los imports al inicio del archivo**

En `worker/src/handlers/web/question.ts`, después de la línea:
```typescript
import { sanitizeUsername } from '../../services/sanitize';
```

Agregar:
```typescript
import { VENUE_CONTEXT } from '../../services/worldcup-venues';
import { HISTORY_CONTEXT } from '../../services/worldcup-history';
```

**Step 2: Extender el system prompt**

El system prompt actual termina en la línea:
```typescript
`Resultados recientes:\n${recentText || 'Sin resultados aún.'}`;
```

Cambiar esa línea por:
```typescript
`Resultados recientes:\n${recentText || 'Sin resultados aún.'}\n\n` +
`Estadios sede del torneo:\n${VENUE_CONTEXT}\n\n` +
`Datos históricos de Mundiales anteriores (2014-2022) y bracket 2026:\n${HISTORY_CONTEXT}`;
```

**Step 3: Verificar TypeScript**

```bash
cd worker && npx tsc --noEmit
```

Expected: sin errores.

**Step 4: Commit**

```bash
rtk git add worker/src/handlers/web/question.ts
rtk git commit -m "feat: inject historical worldcup data and venue context into DeepSeek prompt"
```

---

### Task 4: Verificar build del worker

**Step 1: Correr el build completo**

```bash
cd worker && npm run build 2>&1 | head -50
```

Si `npm run build` no existe, usar:
```bash
cd worker && npx wrangler deploy --dry-run 2>&1 | tail -20
```

Expected: build exitoso sin errores. Si hay errores de tamaño de bundle (>1MB), reportar.

**Step 2: Correr los tests existentes**

```bash
cd worker && rtk vitest run
```

Expected: todos los tests pasan (los tests existentes son de scoring, no se ven afectados).

**Step 3: Commit final si no estaba todo commiteado**

```bash
rtk git status
```

Si hay archivos pendientes:
```bash
rtk git add -A && rtk git commit -m "chore: verify build after historical data integration"
```
