# Stats Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la sección de estadísticas básica por una página con 4 secciones: KPI globales, gráfica de evolución con Chart.js, tabla por usuario y tabla de dificultad de partidos.

**Architecture:** Todo ocurre en `site/src/generate.ts` — se amplía la interfaz `Prediction` a `PredictionDetail` (añade `user_id` y `match_id`), se actualiza `main()` para fetchar esos campos, y se reconstruye `generateStats()` con 4 secciones. Sin migraciones nuevas.

**Tech Stack:** TypeScript, Vitest, Chart.js CDN, CSS inline en la función generadora.

---

## Archivos afectados

| Archivo | Qué cambia |
|---------|-----------|
| `site/src/generate.ts` | Interface `Prediction` → `PredictionDetail`; firma y cuerpo de `generateStats()`; llamada en `main()` |
| `site/src/generate.test.ts` | Actualizar fixture existente; añadir tests para cada nueva sección |

---

## Task 1: Actualizar interfaz PredictionDetail y pipeline de datos

**Files:**
- Modify: `site/src/generate.ts`
- Modify: `site/src/generate.test.ts`

- [ ] **Step 1: Actualizar el test existente de `generateStats` para usar la nueva firma**

En `site/src/generate.test.ts`, añadir `baseFinishedMatch` junto a `baseMatch` (al inicio del archivo, tras la definición de `baseMatch`) y actualizar el test existente:

```typescript
// Añadir después de baseMatch:
const baseFinishedMatch = {
  ...baseMatch,
  status: 'finished' as const,
  home_score: 2,
  away_score: 1,
};

// Reemplazar el test existente 'generateStats returns HTML with stats data':
it('generateStats returns HTML with stats data', () => {
  const html = generateStats(
    [{ user_id: '1', username: 'Alice', total_points: 10, telegram_id: null }],
    [
      { points: 5, user_id: '1', match_id: '1' },
      { points: 3, user_id: '1', match_id: '2' },
      { points: 0, user_id: '1', match_id: '3' },
    ],
    []
  );
  expect(html).toContain('Alice');
});
```

- [ ] **Step 2: Ejecutar tests y verificar que falla por error de TypeScript**

```bash
(cd site && npm test)
```

Expected: error en `generateStats` porque la función aún recibe `(leaderboard, predictions: Prediction[])` — el tercer argumento `[]` sobra.

- [ ] **Step 3: Actualizar interfaz y firma en `generate.ts`**

Reemplazar en `site/src/generate.ts`:

```typescript
// Reemplazar:
interface Prediction {
  points: number | null;
}

// Por:
interface PredictionDetail {
  points: number | null;
  user_id: string;
  match_id: string;
}
```

Actualizar la firma de `generateStats`:

```typescript
// Reemplazar:
export function generateStats(leaderboard: LeaderboardRow[], predictions: Prediction[]): string {

// Por:
export function generateStats(
  leaderboard: LeaderboardRow[],
  predictions: PredictionDetail[],
  matches: VenueMatch[]
): string {
```

Actualizar el tipado interno de la función (el cuerpo actual sigue funcionando — solo usa `p.points`):

```typescript
// Dentro de generateStats, reemplazar:
const resolved = predictions.filter(p => p.points !== null);

// La línea es igual, pero ahora predictions es PredictionDetail[] — sin cambio funcional.
```

- [ ] **Step 4: Actualizar `main()` para fetchar campos extra y pasar `matches` a `generateStats`**

En `site/src/generate.ts`, en la función `main()`:

```typescript
// Reemplazar:
query<Prediction[]>('predictions', { select: 'points' }),

// Por:
query<PredictionDetail[]>('predictions', { select: 'points,user_id,match_id' }),
```

```typescript
// Reemplazar:
fs.writeFileSync(path.join(OUT_DIR, 'stats.html'), generateStats(allLeaderboard, predictions));

// Por:
fs.writeFileSync(path.join(OUT_DIR, 'stats.html'), generateStats(allLeaderboard, predictions, enrichedMatches));
```

- [ ] **Step 5: Ejecutar tests y verificar que pasan**

```bash
(cd site && npm test)
```

Expected: todos los tests pasan, incluyendo el actualizado de `generateStats`.

- [ ] **Step 6: Commit**

```bash
rtk git add site/src/generate.ts site/src/generate.test.ts
rtk git commit -m "refactor: expand Prediction to PredictionDetail with user_id and match_id"
```

---

## Task 2: Sección KPI globales

**Files:**
- Modify: `site/src/generate.ts`
- Modify: `site/src/generate.test.ts`

- [ ] **Step 1: Escribir test para KPI cards**

Añadir en `site/src/generate.test.ts`, dentro del `describe('generate', ...)`:

```typescript
it('generateStats KPI: muestra partidos jugados y porcentajes', () => {
  // 10 predicciones resueltas: 2 exactas(5pts), 5 correctas(3-4pts), 3 ceros
  // exactos = 20%, correctos(3-4) = 50%, ceros = 30% — todos distintos
  const html = generateStats(
    [],
    [
      { points: 5, user_id: 'u1', match_id: 'm1' },
      { points: 5, user_id: 'u2', match_id: 'm1' },
      { points: 4, user_id: 'u1', match_id: 'm2' },
      { points: 4, user_id: 'u2', match_id: 'm2' },
      { points: 3, user_id: 'u1', match_id: 'm3' },
      { points: 3, user_id: 'u2', match_id: 'm3' },
      { points: 3, user_id: 'u1', match_id: 'm4' },
      { points: 0, user_id: 'u2', match_id: 'm4' },
      { points: 0, user_id: 'u1', match_id: 'm5' },
      { points: 0, user_id: 'u2', match_id: 'm5' },
    ],
    [
      { ...baseFinishedMatch, id: 'm1' },
      { ...baseFinishedMatch, id: 'm2' },
      { ...baseFinishedMatch, id: 'm3' },
      { ...baseFinishedMatch, id: 'm4' },
      { ...baseFinishedMatch, id: 'm5' },
      { ...baseMatch, id: 'm6' }, // scheduled — no debe contar
    ]
  );
  expect(html).toContain('kpi-grid');
  expect(html).toContain('5');   // 5 partidos finished (nota: '5' puede aparecer; ok como sanity check)
  expect(html).toContain('20%'); // 2/10 exactos
  expect(html).toContain('50%'); // 5/10 correctos (solo 3-4pts, NO incluye 5pts)
  expect(html).toContain('30%'); // 3/10 ceros
});
```

- [ ] **Step 2: Ejecutar test y verificar que falla**

```bash
(cd site && npm test)
```

Expected: FAIL — `kpi-grid` no está en el HTML generado.

- [ ] **Step 3: Reemplazar el cuerpo de `generateStats` con la nueva estructura**

Reemplazar el cuerpo completo de `generateStats` en `site/src/generate.ts`:

```typescript
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
  const correct = resolved.filter(p => (p.points ?? 0) >= 3 && (p.points ?? 0) < 5).length;
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
  </style>`;

  const kpiSection = `
    <div class="stats-section">
      <h2>🌐 Resumen global</h2>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-value">${finishedCount}</div><div class="kpi-label">Partidos jugados</div></div>
        <div class="kpi"><div class="kpi-value kpi-green">${pct(exact)}</div><div class="kpi-label">🎯 Exactos (5 pts)</div></div>
        <div class="kpi"><div class="kpi-value kpi-orange">${pct(correct)}</div><div class="kpi-label">✔️ Correctos (3–4 pts)</div></div>
        <div class="kpi"><div class="kpi-value kpi-red">${pct(zero)}</div><div class="kpi-label">❌ Sin puntos (0 pts)</div></div>
      </div>
    </div>`;

  return layout('Estadísticas', `
    ${statsStyles}
    <h1>📊 Estadísticas — Mundial 2026</h1>
    ${kpiSection}
  `);
}
```

- [ ] **Step 4: Ejecutar tests y verificar que pasan**

```bash
(cd site && npm test)
```

Expected: todos pasan.

- [ ] **Step 5: Commit**

```bash
rtk git add site/src/generate.ts site/src/generate.test.ts
rtk git commit -m "feat: add KPI cards section to stats page"
```

---

## Task 3: Tabla de desglose por participante

**Files:**
- Modify: `site/src/generate.ts`
- Modify: `site/src/generate.test.ts`

- [ ] **Step 1: Escribir test para la tabla de usuario**

Añadir en `site/src/generate.test.ts`:

```typescript
it('generateStats tabla usuario: exactos, correctos, ceros y promedio', () => {
  // Alice: 1 exacto (5pts), 1 correcto (3pts), 1 cero (0pts) → total=8, promedio=8/3=2.7
  const html = generateStats(
    [{ user_id: 'u1', username: 'Alice', total_points: 8, telegram_id: null }],
    [
      { points: 5, user_id: 'u1', match_id: 'm1' },
      { points: 3, user_id: 'u1', match_id: 'm2' },
      { points: 0, user_id: 'u1', match_id: 'm3' },
    ],
    [
      { ...baseFinishedMatch, id: 'm1' },
      { ...baseFinishedMatch, id: 'm2' },
      { ...baseFinishedMatch, id: 'm3' },
    ]
  );
  expect(html).toContain('Alice');
  expect(html).toContain('2.7'); // promedio (8/3)
  expect(html).toContain('3/3'); // participación (predicho 3 de 3 jugados)
});

it('generateStats tabla usuario: promedio — cuando no hay predicciones resueltas', () => {
  const html = generateStats(
    [{ user_id: 'u1', username: 'Bob', total_points: 0, telegram_id: null }],
    [],
    [{ ...baseFinishedMatch, id: 'm1' }]
  );
  expect(html).toContain('Bob');
  expect(html).toContain('—'); // promedio cuando played === 0
});
```

- [ ] **Step 2: Ejecutar tests y verificar que fallan**

```bash
(cd site && npm test)
```

Expected: FAIL — `2.7` y `3/3` no están en el HTML.

- [ ] **Step 3: Añadir la sección de tabla de usuarios en `generateStats`**

En `site/src/generate.ts`, dentro de `generateStats`, añadir el siguiente bloque justo antes del `return layout(...)` y añadir `${userTable}` en el template:

```typescript
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
    const uCorrect = userPreds.filter(p => (p.points ?? 0) >= 3 && (p.points ?? 0) < 5).length;
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
```

Actualizar el `return layout(...)` para incluir `${userTable}`:

```typescript
  return layout('Estadísticas', `
    ${statsStyles}
    <h1>📊 Estadísticas — Mundial 2026</h1>
    ${kpiSection}
    ${userTable}
  `);
```

- [ ] **Step 4: Ejecutar tests y verificar que pasan**

```bash
(cd site && npm test)
```

Expected: todos pasan.

- [ ] **Step 5: Commit**

```bash
rtk git add site/src/generate.ts site/src/generate.test.ts
rtk git commit -m "feat: add per-user breakdown table to stats page"
```

---

## Task 4: Tabla de partidos más y menos predecibles

**Files:**
- Modify: `site/src/generate.ts`
- Modify: `site/src/generate.test.ts`

- [ ] **Step 1: Escribir tests para la tabla de dificultad**

Añadir en `site/src/generate.test.ts`:

```typescript
it('generateStats dificultad: identifica partido fácil y difícil', () => {
  // m1: 2 aciertos de 2 → 100% (fácil)
  // m2: 0 aciertos de 2 → 0%  (difícil)
  const html = generateStats(
    [],
    [
      { points: 5, user_id: 'u1', match_id: 'm1' },
      { points: 3, user_id: 'u2', match_id: 'm1' },
      { points: 0, user_id: 'u1', match_id: 'm2' },
      { points: 0, user_id: 'u2', match_id: 'm2' },
    ],
    [
      { ...baseFinishedMatch, id: 'm1', home_team: 'España', away_team: 'Alemania' },
      { ...baseFinishedMatch, id: 'm2', home_team: 'Japón', away_team: 'Senegal' },
    ]
  );
  expect(html).toContain('100%'); // España vs Alemania → fácil
  expect(html).toContain('0%');   // Japón vs Senegal → difícil
  expect(html).toContain('😎');
  expect(html).toContain('😱');
});

it('generateStats dificultad: excluye partidos sin predicciones', () => {
  const html = generateStats(
    [],
    [],
    [{ ...baseFinishedMatch, id: 'm1', home_team: 'Colombia', away_team: 'Brasil' }]
  );
  // Sin predicciones, la tabla muestra el mensaje vacío
  expect(html).not.toContain('Colombia vs Brasil');
});
```

- [ ] **Step 2: Ejecutar tests y verificar que fallan**

```bash
(cd site && npm test)
```

Expected: FAIL — `100%`, `0%`, `😎`, `😱` no están en el HTML.

- [ ] **Step 3: Añadir la sección de dificultad en `generateStats`**

En `site/src/generate.ts`, añadir justo antes del `return layout(...)`:

```typescript
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

  const easiest = [...diffData]
    .sort((a, b) => b.pct - a.pct || b.total - a.total)
    .slice(0, 3);
  const hardest = [...diffData]
    .sort((a, b) => a.pct - b.pct || a.total - b.total)
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
```

Actualizar el `return layout(...)` para incluir `${diffTable}`:

```typescript
  return layout('Estadísticas', `
    ${statsStyles}
    <h1>📊 Estadísticas — Mundial 2026</h1>
    ${kpiSection}
    ${userTable}
    ${diffTable}
  `);
```

- [ ] **Step 4: Ejecutar tests y verificar que pasan**

```bash
(cd site && npm test)
```

Expected: todos pasan.

- [ ] **Step 5: Commit**

```bash
rtk git add site/src/generate.ts site/src/generate.test.ts
rtk git commit -m "feat: add match difficulty table to stats page"
```

---

## Task 5: Gráfica de evolución con Chart.js

**Files:**
- Modify: `site/src/generate.ts`
- Modify: `site/src/generate.test.ts`

- [ ] **Step 1: Escribir test para la sección Chart.js**

Añadir en `site/src/generate.test.ts`:

```typescript
it('generateStats evolución: embebe CDN de Chart.js y datos de usuarios', () => {
  const html = generateStats(
    [
      { user_id: 'u1', username: 'Alice', total_points: 8, telegram_id: null },
      { user_id: 'u2', username: 'Bob',   total_points: 3, telegram_id: null },
    ],
    [
      { points: 5, user_id: 'u1', match_id: 'm1' },
      { points: 3, user_id: 'u1', match_id: 'm2' },
      { points: 3, user_id: 'u2', match_id: 'm1' },
      { points: 0, user_id: 'u2', match_id: 'm2' },
    ],
    [
      { ...baseFinishedMatch, id: 'm1', kickoff_at: '2026-06-15T18:00:00Z' },
      { ...baseFinishedMatch, id: 'm2', kickoff_at: '2026-06-16T18:00:00Z' },
    ]
  );
  expect(html).toContain('cdn.jsdelivr.net/npm/chart.js');
  expect(html).toContain('<canvas');
  expect(html).toContain('"Alice"');
  expect(html).toContain('"Bob"');
  // Alice acumula: P1=5, P2=8
  expect(html).toContain('[5,8]');
  // Bob acumula: P1=3, P2=3
  expect(html).toContain('[3,3]');
});
```

- [ ] **Step 2: Ejecutar test y verificar que falla**

```bash
(cd site && npm test)
```

Expected: FAIL — `cdn.jsdelivr.net` y `<canvas` no están en el HTML.

- [ ] **Step 3: Añadir la sección de Chart.js en `generateStats`**

En `site/src/generate.ts`, añadir justo antes de la sección de `userTable`:

```typescript
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

  const chartJson = JSON.stringify({ labels: chartLabels, datasets });

  const chartSection = `
    <div class="stats-section">
      <h2>📈 Evolución de puntos acumulados</h2>
      <canvas id="evolution-chart" height="80"></canvas>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
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
```

Actualizar el `return layout(...)` para incluir `${chartSection}` entre KPI y la tabla de usuario:

```typescript
  return layout('Estadísticas', `
    ${statsStyles}
    <h1>📊 Estadísticas — Mundial 2026</h1>
    ${kpiSection}
    ${chartSection}
    ${userTable}
    ${diffTable}
  `);
```

- [ ] **Step 4: Ejecutar todos los tests y verificar que pasan**

```bash
(cd site && npm test)
```

Expected: todos pasan. Output similar a:

```
 ✓ generate > layout returns an HTML string containing the title
 ✓ generate > generateIndex returns HTML with leaderboard data
 ✓ generate > generatePartidos returns HTML with match data
 ✓ generate > generatePartidos shows venue info
 ✓ generate > generatePartidos groups by phase
 ✓ generate > generatePartidos shows group labels for group stage
 ✓ generate > generateStats returns HTML with stats data
 ✓ generate > generateStats KPI: muestra partidos jugados y porcentajes
 ✓ generate > generateStats tabla usuario: exactos, correctos, ceros y promedio
 ✓ generate > generateStats tabla usuario: promedio — cuando no hay predicciones resueltas
 ✓ generate > generateStats dificultad: identifica partido fácil y difícil
 ✓ generate > generateStats dificultad: excluye partidos sin predicciones
 ✓ generate > generateStats evolución: embebe CDN de Chart.js y datos de usuarios
 ✓ layout() responsive > incluye media query para móvil
 ✓ layout() responsive > oculta thead en móvil
 ✓ layout() responsive > usa data-label en td::before
Tests: 16 passed
```

- [ ] **Step 5: Commit final**

```bash
rtk git add site/src/generate.ts site/src/generate.test.ts
rtk git commit -m "feat: add Chart.js evolution chart to stats page"
```

---

## Verificación manual (opcional)

Para ver el resultado real antes de hacer deploy:

```bash
cd site && SUPABASE_URL=<url> SUPABASE_SERVICE_KEY=<key> npm run generate
# Abrir dist/stats.html en el navegador
```

Si no hay datos reales disponibles, revisar que `dist/stats.html` contenga las 4 secciones (`kpi-grid`, `<canvas`, tabla con `Participante`, tabla con `% Aciertos`).
