# Dynamic Ranking Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `index.html` fetch the ranking live from `/api/ranking` at load time instead of baking stale data at build time.

**Architecture:** `generateIndex()` in `site/src/generate.ts` is changed to take no arguments and return a static HTML shell with an inline JS snippet. The snippet uses the Supabase JS SDK to read the existing session from localStorage, then fetches `/api/ranking` with that JWT and renders the table. `main()` stops passing leaderboard data to `generateIndex()` (leaderboard query is kept for `stats.html`).

**Tech Stack:** TypeScript, Vitest, Supabase JS SDK (CDN), Cloudflare Workers API

---

### Task 1: Update the test for `generateIndex`

**Files:**
- Modify: `site/src/generate.test.ts:25-32`

**Step 1: Replace the existing `generateIndex` test**

The current test passes leaderboard data and checks for `'Alice'` and `'10'`. After the change, `generateIndex()` takes no arguments and generates a JS-driven shell. Replace the test at lines 25–32 with:

```typescript
it('generateIndex returns a dynamic shell with JS snippet', () => {
  const html = generateIndex();
  expect(html).toContain('ranking-container');
  expect(html).toContain('/api/ranking');
  expect(html).toContain('getSession');
  expect(html).toContain('jugar.html');
});
```

**Step 2: Run the test to verify it fails**

```bash
cd site && npx vitest run src/generate.test.ts
```

Expected: FAIL — `generateIndex` still expects arguments and returns static HTML.

---

### Task 2: Implement the new `generateIndex()`

**Files:**
- Modify: `site/src/generate.ts:201-220`

**Step 1: Replace the function signature and body**

Remove the `leagues` parameter and replace the static table with a dynamic shell. The new function:

```typescript
export function generateIndex(): string {
  const SUPABASE_URL  = 'https://rhclzawbdxsitwtzdies.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_ia5yM6iARW7xUasAVGFFxA_nu6REkoU';
  const WORKER_URL    = 'https://oraculobot-worker.carlos-ardila-account.workers.dev';

  const script = `
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"><\/script>
    <script>
    (async () => {
      const sb = supabase.createClient('${SUPABASE_URL}', '${SUPABASE_ANON}');
      const { data: { session } } = await sb.auth.getSession();
      const el = document.getElementById('ranking-container');
      if (!session) {
        el.innerHTML = '<p>Para ver el ranking, <a href="jugar.html">inicia sesión aquí</a>.</p>';
        return;
      }
      const res = await fetch('${WORKER_URL}/api/ranking', {
        headers: { 'Authorization': 'Bearer ' + session.access_token }
      });
      if (!res.ok) { el.innerHTML = '<p>Error al cargar el ranking.</p>'; return; }
      const { league_name, ranking } = await res.json();
      const MEDALS = ['🥇', '🥈', '🥉'];
      const rows = ranking.map((r, i) =>
        '<tr><td>' + (MEDALS[i] ?? i + 1) + '</td><td>' + (r.username ?? 'Anónimo') + '</td><td><b>' + r.total_points + '</b></td></tr>'
      ).join('');
      el.innerHTML =
        '<h2>🏆 ' + (league_name ?? 'Ranking') + '</h2>' +
        '<table><thead><tr><th>#</th><th>Participante</th><th>Puntos</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    })();
    <\/script>`;

  return layout('Ranking', `
    <h1>🏆 Ranking — Mundial 2026</h1>
    <div id="ranking-container"><p>Cargando ranking...</p></div>
    ${script}
  `);
}
```

**Step 2: Run tests to verify they pass**

```bash
cd site && npx vitest run src/generate.test.ts
```

Expected: All tests PASS, including the new `generateIndex` test.

**Step 3: Commit**

```bash
rtk git add site/src/generate.test.ts site/src/generate.ts
rtk git commit -m "feat: make ranking page dynamic — fetch from /api/ranking at load time"
```

---

### Task 3: Update `main()` to stop passing leaderboard to `generateIndex`

**Files:**
- Modify: `site/src/generate.ts:565`

**Step 1: Change the call site in `main()`**

Find line 565:
```typescript
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), generateIndex(leagueBoards));
```

Replace with:
```typescript
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), generateIndex());
```

The `leagueBoards` variable stays because `generateStats` still needs it on the next lines.

**Step 2: Run all tests**

```bash
cd site && npx vitest run
```

Expected: All tests PASS, no TypeScript errors.

**Step 3: Verify TypeScript compiles cleanly**

```bash
cd site && npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
rtk git add site/src/generate.ts
rtk git commit -m "chore: remove leaderboard arg from generateIndex call in main()"
```

---

### Task 4: Manual smoke test

**Step 1: Build the site locally**

```bash
cd site && SUPABASE_URL=<url> SUPABASE_SERVICE_KEY=<key> npm run generate
```

Expected: `dist/index.html` generated. Open it in a browser (or check source) — should contain `ranking-container` div and the `<script>` tag instead of a static table.

**Step 2: Verify old static content is gone**

```bash
grep -c 'Alice\|leaderboard' site/dist/index.html
```

Expected: `0` (no user data baked in).

**Step 3: Verify JS snippet is present**

```bash
grep 'api/ranking' site/dist/index.html
```

Expected: match found.
