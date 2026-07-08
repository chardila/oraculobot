# Stats: Consenso por Partido y Personalidades — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two new sections to `stats.html` — "Consenso por partido" (most popular predicted score + exact/correct/zero counts per match) and "Personalidades" (fun badges per user based on prediction style).

**Architecture:** All computation in `site/src/generate.ts`. Extend `PredictionDetail` with optional `home_score`/`away_score` fields (backwards-compatible with existing tests). New helper logic inside `generateStats`. Sections inserted between KPIs and the evolution chart.

**Tech Stack:** TypeScript, Vitest (`site/src/generate.test.ts`), static HTML with inline CSS.

---

### Task 1: Extend PredictionDetail with score fields

**Files:**
- Modify: `site/src/generate.ts` — `PredictionDetail` interface (lines 47–51) and query in `main()` (line 589)
- Test: `site/src/generate.test.ts`

**Step 1: Write failing test**

Add to `generate.test.ts` inside the `generate` describe block:

```typescript
it('consenso: renders section heading', () => {
  const match = { ...baseFinishedMatch, id: 'm1' };
  const predictions = [
    { points: 5, user_id: 'u1', match_id: 'm1', home_score: 2, away_score: 1 },
    { points: 0, user_id: 'u2', match_id: 'm1', home_score: 1, away_score: 0 },
  ];
  const html = generateStats([], predictions, [match]);
  expect(html).toContain('Consenso por partido');
});
```

**Step 2: Run test to verify it fails**

```bash
cd site && npx vitest run src/generate.test.ts -t 'consenso'
```

Expected: FAIL — `home_score` is not on `PredictionDetail`, TypeScript error.

**Step 3: Extend PredictionDetail**

```typescript
interface PredictionDetail {
  points: number | null;
  user_id: string;
  match_id: string;
  home_score?: number | null;   // optional — backwards-compatible with existing tests
  away_score?: number | null;
}
```

**Step 4: Update query in main()**

```typescript
query<PredictionDetail[]>('predictions', { select: 'points,user_id,match_id,home_score,away_score' }),
```

**Step 5: Run all tests to make sure nothing broke**

```bash
cd site && npx vitest run src/generate.test.ts
```

Expected: all existing tests pass, new test still fails (section not rendered yet).

**Step 6: Commit**

```bash
git add site/src/generate.ts site/src/generate.test.ts
git commit -m "feat: extend PredictionDetail with home_score and away_score"
```

---

### Task 2: Implement consenso por partido section

**Files:**
- Modify: `site/src/generate.ts` — add logic inside `generateStats`, add CSS to `statsStyles`

**Step 1: Write complete tests**

Add to `generate.test.ts`:

```typescript
it('consenso: shows most popular predicted score and count', () => {
  const match = { ...baseFinishedMatch, id: 'm1', home_team: 'Mexico', away_team: 'South Africa' };
  const predictions = [
    { points: 0, user_id: 'u1', match_id: 'm1', home_score: 2, away_score: 1 },
    { points: 0, user_id: 'u2', match_id: 'm1', home_score: 2, away_score: 1 },
    { points: 5, user_id: 'u3', match_id: 'm1', home_score: 2, away_score: 0 },
  ];
  const html = generateStats([], predictions, [match]);
  expect(html).toContain('2-1');          // most popular
  expect(html).toContain('2 personas');   // count
});

it('consenso: shows nadie lo vio venir when no exactos', () => {
  const match = { ...baseFinishedMatch, id: 'm1' };
  const predictions = [
    { points: 0, user_id: 'u1', match_id: 'm1', home_score: 1, away_score: 0 },
    { points: 3, user_id: 'u2', match_id: 'm1', home_score: 3, away_score: 1 },
  ];
  const html = generateStats([], predictions, [match]);
  expect(html).toContain('Nadie lo vio venir');
});

it('consenso: does NOT show nadie when there are exactos', () => {
  const match = { ...baseFinishedMatch, id: 'm1' };
  const predictions = [
    { points: 5, user_id: 'u1', match_id: 'm1', home_score: 2, away_score: 1 },
    { points: 0, user_id: 'u2', match_id: 'm1', home_score: 1, away_score: 0 },
  ];
  const html = generateStats([], predictions, [match]);
  expect(html).not.toContain('Nadie lo vio venir');
});

it('consenso: counts exactos, correctos, ceros per match', () => {
  const match = { ...baseFinishedMatch, id: 'm1' };
  const predictions = [
    { points: 5, user_id: 'u1', match_id: 'm1', home_score: 2, away_score: 1 },
    { points: 3, user_id: 'u2', match_id: 'm1', home_score: 2, away_score: 0 },
    { points: 0, user_id: 'u3', match_id: 'm1', home_score: 0, away_score: 0 },
  ];
  const html = generateStats([], predictions, [match]);
  expect(html).toContain('Exactos: 1');
  expect(html).toContain('Correctos: 1');
  expect(html).toContain('Ceros: 1');
});
```

**Step 2: Run tests to verify they fail**

```bash
cd site && npx vitest run src/generate.test.ts -t 'consenso'
```

**Step 3: Add CSS to statsStyles in generateStats**

Add inside the `<style>` block in `statsStyles`:

```css
.consenso-card{border:1px solid #e5e5e5;border-radius:10px;padding:.9rem 1rem;margin-bottom:.75rem;background:#fafafa;}
.consenso-match{font-weight:700;font-size:.95rem;margin-bottom:.35rem;}
.consenso-popular{font-size:.87rem;color:#333;margin-bottom:.25rem;}
.consenso-counts{font-size:.82rem;color:#555;gap:1rem;display:flex;flex-wrap:wrap;}
.badge-sorpresa{background:#fff3e0;color:#b96a00;border-radius:8px;padding:1px 8px;font-size:.75rem;font-weight:600;margin-left:.4rem;}
```

**Step 4: Add consenso logic inside generateStats, after the `predByMatch` map already used by diffData**

Add this block right before the `return layout(...)` call:

```typescript
// ── Sección: Consenso por partido ───────────────────────────────────────
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
```

**Step 5: Inject consensoSection in the return**

In the `return layout(...)` call, change:

```typescript
return layout('Estadísticas', `
  ${statsStyles}
  <h1>📊 Estadísticas — Mundial 2026</h1>
  ${kpiSection}
  ${chartSection}
  ${userTable}
  ${diffTable}
`, 'stats');
```

To:

```typescript
return layout('Estadísticas', `
  ${statsStyles}
  <h1>📊 Estadísticas — Mundial 2026</h1>
  ${kpiSection}
  ${consensoSection}
  ${chartSection}
  ${userTable}
  ${diffTable}
`, 'stats');
```

**Step 6: Run tests**

```bash
cd site && npx vitest run src/generate.test.ts
```

Expected: all pass.

**Step 7: Commit**

```bash
git add site/src/generate.ts site/src/generate.test.ts
git commit -m "feat: add consenso por partido section to stats"
```

---

### Task 3: Implement personalidades section

**Files:**
- Modify: `site/src/generate.ts`
- Test: `site/src/generate.test.ts`

**Badges:**
| Badge | Criterio |
|---|---|
| 🎯 El Adivino | Más predicciones exactas (points === 5). Solo si exactos > 0. |
| 😤 El Atrevido | Mayor promedio de goles totales predichos (home_score + away_score). |
| 🛡️ El Conservador | Menor promedio de goles totales predichos. |
| 🎲 El Único | Más partidos donde predijo un marcador que nadie más predijo. Solo si unico > 0. |

Ties share the badge. Users with no resolved predictions are excluded.

**Step 1: Write failing tests**

```typescript
it('personalidades: shows section heading', () => {
  const match = { ...baseFinishedMatch, id: 'm1' };
  const leaderboard = [{ user_id: 'u1', username: 'Alice', total_points: 5, telegram_id: null }];
  const predictions = [{ points: 5, user_id: 'u1', match_id: 'm1', home_score: 2, away_score: 1 }];
  const html = generateStats(leaderboard, predictions, [match]);
  expect(html).toContain('Personalidades');
});

it('personalidades: assigns El Adivino to user with most exactos', () => {
  const matches = [
    { ...baseFinishedMatch, id: 'm1' },
    { ...baseFinishedMatch, id: 'm2' },
  ];
  const leaderboard = [
    { user_id: 'u1', username: 'Alice', total_points: 10, telegram_id: null },
    { user_id: 'u2', username: 'Bob',   total_points: 5,  telegram_id: null },
  ];
  const predictions = [
    { points: 5, user_id: 'u1', match_id: 'm1', home_score: 2, away_score: 1 },
    { points: 5, user_id: 'u1', match_id: 'm2', home_score: 2, away_score: 1 },
    { points: 5, user_id: 'u2', match_id: 'm1', home_score: 2, away_score: 1 },
    { points: 0, user_id: 'u2', match_id: 'm2', home_score: 0, away_score: 0 },
  ];
  const html = generateStats(leaderboard, predictions, matches);
  // Alice has 2 exactos, Bob has 1 → Alice gets El Adivino
  const aliceSection = html.indexOf('Alice');
  const adivino = html.indexOf('El Adivino');
  expect(adivino).toBeGreaterThan(-1);
});

it('personalidades: assigns El Atrevido to highest avg goals', () => {
  const match = { ...baseFinishedMatch, id: 'm1' };
  const leaderboard = [
    { user_id: 'u1', username: 'Alice', total_points: 3, telegram_id: null },
    { user_id: 'u2', username: 'Bob',   total_points: 0, telegram_id: null },
  ];
  const predictions = [
    { points: 3, user_id: 'u1', match_id: 'm1', home_score: 4, away_score: 3 }, // avg=7
    { points: 0, user_id: 'u2', match_id: 'm1', home_score: 1, away_score: 0 }, // avg=1
  ];
  const html = generateStats(leaderboard, predictions, [match]);
  expect(html).toContain('El Atrevido');
});

it('personalidades: assigns El Conservador to lowest avg goals', () => {
  const match = { ...baseFinishedMatch, id: 'm1' };
  const leaderboard = [
    { user_id: 'u1', username: 'Alice', total_points: 3, telegram_id: null },
    { user_id: 'u2', username: 'Bob',   total_points: 0, telegram_id: null },
  ];
  const predictions = [
    { points: 3, user_id: 'u1', match_id: 'm1', home_score: 4, away_score: 3 },
    { points: 0, user_id: 'u2', match_id: 'm1', home_score: 1, away_score: 0 },
  ];
  const html = generateStats(leaderboard, predictions, [match]);
  expect(html).toContain('El Conservador');
});

it('personalidades: assigns El Unico to user with most unique predictions', () => {
  const match = { ...baseFinishedMatch, id: 'm1' };
  const leaderboard = [
    { user_id: 'u1', username: 'Alice', total_points: 0, telegram_id: null },
    { user_id: 'u2', username: 'Bob',   total_points: 0, telegram_id: null },
    { user_id: 'u3', username: 'Carol', total_points: 0, telegram_id: null },
  ];
  const predictions = [
    { points: 0, user_id: 'u1', match_id: 'm1', home_score: 3, away_score: 3 }, // unique
    { points: 0, user_id: 'u2', match_id: 'm1', home_score: 1, away_score: 0 },
    { points: 0, user_id: 'u3', match_id: 'm1', home_score: 1, away_score: 0 },
  ];
  const html = generateStats(leaderboard, predictions, [match]);
  expect(html).toContain('El Único');
});

it('personalidades: hidden when no resolved predictions', () => {
  const html = generateStats(
    [{ user_id: 'u1', username: 'Alice', total_points: 0, telegram_id: null }],
    [],
    []
  );
  expect(html).not.toContain('Personalidades');
});
```

**Step 2: Run tests to verify they fail**

```bash
cd site && npx vitest run src/generate.test.ts -t 'personalidades'
```

**Step 3: Add personalidades CSS to statsStyles**

```css
.pers-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.75rem;margin-top:.5rem;}
.pers-card{background:#f8f9fa;border-radius:10px;padding:.9rem;text-align:center;}
.pers-name{font-weight:600;font-size:.88rem;margin-bottom:.5rem;color:#1a1a1a;}
.pers-badge{display:inline-block;background:#e8f0fe;color:#1a5a8c;border-radius:12px;padding:3px 10px;font-size:.76rem;font-weight:600;margin:2px;}
.pers-badge-none{background:#f0f0f0;color:#888;}
```

**Step 4: Add personalidades logic inside generateStats, after consensoSection**

```typescript
// ── Sección: Personalidades ──────────────────────────────────────────────
interface UserPStats {
  user_id: string;
  username: string;
  exactos: number;
  avgGoals: number;
  unicoCount: number;
}

// Per-match score groups needed for El Único
const matchScoreGroups = new Map<string, Map<string, number>>(); // matchId → "h-a" → count
for (const p of predictions) {
  if (p.home_score == null || p.away_score == null || p.points === null) continue;
  if (!matchScoreGroups.has(p.match_id)) matchScoreGroups.set(p.match_id, new Map());
  const key = `${p.home_score}-${p.away_score}`;
  const g = matchScoreGroups.get(p.match_id)!;
  g.set(key, (g.get(key) ?? 0) + 1);
}

const persStats: UserPStats[] = [];
for (const u of leaderboard) {
  const up = predictions.filter(p =>
    p.user_id === u.user_id && p.points !== null && p.home_score != null && p.away_score != null
  );
  if (!up.length) continue;

  const exactos = up.filter(p => p.points === 5).length;
  const avgGoals = up.reduce((s, p) => s + (p.home_score ?? 0) + (p.away_score ?? 0), 0) / up.length;

  let unicoCount = 0;
  for (const p of up) {
    const key = `${p.home_score}-${p.away_score}`;
    if ((matchScoreGroups.get(p.match_id)?.get(key) ?? 0) === 1) unicoCount++;
  }

  persStats.push({ user_id: u.user_id, username: u.username ?? 'Anónimo', exactos, avgGoals, unicoCount });
}

let personalidadesSection = '';
if (persStats.length > 0) {
  const maxExactos = Math.max(...persStats.map(s => s.exactos));
  const maxAvg     = Math.max(...persStats.map(s => s.avgGoals));
  const minAvg     = Math.min(...persStats.map(s => s.avgGoals));
  const maxUnico   = Math.max(...persStats.map(s => s.unicoCount));

  const getBadges = (s: UserPStats): string[] => {
    const b: string[] = [];
    if (s.exactos > 0 && s.exactos === maxExactos)   b.push('🎯 El Adivino');
    if (s.avgGoals === maxAvg)                         b.push('😤 El Atrevido');
    if (s.avgGoals === minAvg && maxAvg !== minAvg)    b.push('🛡️ El Conservador');
    if (s.unicoCount > 0 && s.unicoCount === maxUnico) b.push('🎲 El Único');
    return b;
  };

  const cards = persStats.map(s => {
    const bs = getBadges(s);
    const badgeHtml = bs.length
      ? bs.map(b => `<span class="pers-badge">${b}</span>`).join('')
      : '<span class="pers-badge pers-badge-none">😐 Sin badge aún</span>';
    return `<div class="pers-card"><div class="pers-name">${s.username}</div><div>${badgeHtml}</div></div>`;
  }).join('');

  personalidadesSection = `
    <div class="stats-section">
      <h2>🎭 Personalidades</h2>
      <div class="pers-grid">${cards}</div>
    </div>`;
}
```

**Step 5: Inject personalidadesSection in the return**

```typescript
return layout('Estadísticas', `
  ${statsStyles}
  <h1>📊 Estadísticas — Mundial 2026</h1>
  ${kpiSection}
  ${consensoSection}
  ${personalidadesSection}
  ${chartSection}
  ${userTable}
  ${diffTable}
`, 'stats');
```

**Step 6: Run all tests**

```bash
cd site && npx vitest run src/generate.test.ts
```

Expected: all pass.

**Step 7: Commit**

```bash
git add site/src/generate.ts site/src/generate.test.ts
git commit -m "feat: add personalidades badges section to stats"
```

---

### Task 4: Smoke test and deploy

**Step 1: Run full test suite**

```bash
cd site && npx vitest run
```

Expected: all tests pass, no regressions.

**Step 2: Generate locally and inspect**

```bash
cd site && SUPABASE_URL=<url> SUPABASE_SERVICE_KEY=<key> npm run generate
```

Open `site/dist/stats.html` in browser. Verify:
- KPIs at top
- "Consenso por partido" section below KPIs — cards for each finished match
- "Personalidades" section — grid of user cards with badges
- Evolution chart still renders
- Mobile: resize to < 600px, verify cards stack correctly

**Step 3: Push and trigger site build**

```bash
git push
gh workflow run build-site.yml --repo chardila/oraculobot
```
