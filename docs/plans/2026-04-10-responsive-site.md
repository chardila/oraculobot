# Responsive Static Site Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hacer responsivas las tablas del sitio estático en móvil (≤480px) convirtiéndolas en tarjetas usando CSS `data-label`.

**Architecture:** Se agrega un bloque `@media (max-width: 480px)` al CSS inline del `layout()` y atributos `data-label` a cada `<td>` en las tres funciones generadoras. En desktop la tabla permanece intacta; en móvil cada fila se convierte en una tarjeta con etiquetas.

**Tech Stack:** TypeScript, tsx, vitest (a agregar), HTML/CSS inline generado

---

### Task 1: Configurar vitest en `site/`

**Files:**
- Modify: `site/package.json`
- Create: `site/src/generate.test.ts`

**Step 1: Instalar vitest**

```bash
cd site && npm install --save-dev vitest
```

**Step 2: Agregar script de test a `site/package.json`**

Reemplazar:
```json
"test": "echo \"Error: no test specified\" && exit 1",
```
Con:
```json
"test": "vitest run",
```

**Step 3: Exportar las funciones generadoras en `site/src/generate.ts`**

Cambiar las declaraciones `function` a `export function` para las tres funciones:
- `generateIndex`
- `generatePartidos`
- `generateStats`

También exportar `layout`:
```ts
export function layout(title: string, body: string): string {
```

**Step 4: Crear archivo de test vacío**

```bash
touch site/src/generate.test.ts
```

**Step 5: Verificar que vitest corre sin errores**

```bash
cd site && npm test
```
Expected: `No test files found` o `0 tests passed`

**Step 6: Commit**

```bash
rtk git add site/package.json site/src/generate.ts site/src/generate.test.ts && rtk git commit -m "test: set up vitest for site generator"
```

---

### Task 2: CSS responsivo en `layout()`

**Files:**
- Modify: `site/src/generate.ts` — función `layout()`
- Modify: `site/src/generate.test.ts`

**Step 1: Escribir test que falla**

En `site/src/generate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { layout } from './generate';

describe('layout()', () => {
  it('incluye media query para móvil', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('@media (max-width: 480px)');
  });

  it('oculta thead en móvil', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('thead { display: none }');
  });

  it('estila tr como tarjeta en móvil', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('border-radius');
  });

  it('usa data-label en td::before', () => {
    const html = layout('Test', '<p>body</p>');
    expect(html).toContain('content: attr(data-label)');
  });
});
```

**Step 2: Verificar que los tests fallan**

```bash
cd site && npm test
```
Expected: 4 tests FAIL

**Step 3: Agregar CSS responsivo en `layout()`**

Dentro del bloque `<style>` existente, agregar al final (antes del cierre `</style>`):

```css
    @media (max-width: 480px) {
      thead { display: none }
      table, tbody, tr, td { display: block; width: 100%; }
      tr { border: 1px solid #e5e5e5; border-radius: 8px; margin-bottom: 0.75rem; padding: 0.5rem; }
      td { border-bottom: none; padding: 0.25rem 0.5rem; display: flex; justify-content: space-between; align-items: center; }
      td::before { content: attr(data-label); font-weight: 600; color: #555; margin-right: 0.5rem; flex-shrink: 0; }
    }
```

**Step 4: Verificar que los tests pasan**

```bash
cd site && npm test
```
Expected: 4 tests PASS

**Step 5: Commit**

```bash
rtk git add site/src/generate.ts site/src/generate.test.ts && rtk git commit -m "feat: add responsive CSS to site layout"
```

---

### Task 3: `data-label` en `generateIndex()` (ranking)

**Files:**
- Modify: `site/src/generate.ts` — función `generateIndex()`
- Modify: `site/src/generate.test.ts`

**Step 1: Escribir tests que fallan**

Agregar al final de `site/src/generate.test.ts`:

```ts
import { generateIndex } from './generate';

describe('generateIndex()', () => {
  const rows = [{ user_id: '1', username: 'Alice', total_points: 10 }];

  it('incluye data-label="#" en la primera celda', () => {
    const html = generateIndex(rows);
    expect(html).toContain('data-label="#"');
  });

  it('incluye data-label="Participante"', () => {
    const html = generateIndex(rows);
    expect(html).toContain('data-label="Participante"');
  });

  it('incluye data-label="Puntos"', () => {
    const html = generateIndex(rows);
    expect(html).toContain('data-label="Puntos"');
  });
});
```

**Step 2: Verificar que los tests fallan**

```bash
cd site && npm test
```
Expected: 3 tests FAIL

**Step 3: Agregar `data-label` en `generateIndex()`**

En la función `generateIndex()`, cambiar el template de cada `<tr>`:

```ts
`<tr>
  <td data-label="#">${MEDALS[i] ?? i + 1}</td>
  <td data-label="Participante">${r.username ?? 'Anónimo'}</td>
  <td data-label="Puntos"><b>${r.total_points}</b></td>
</tr>`
```

Y el row vacío:
```ts
'<tr><td colspan="3" data-label="">Sin puntos registrados aún.</td></tr>'
```

**Step 4: Verificar que los tests pasan**

```bash
cd site && npm test
```
Expected: todos los tests PASS

**Step 5: Commit**

```bash
rtk git add site/src/generate.ts site/src/generate.test.ts && rtk git commit -m "feat: add data-label to ranking table for mobile"
```

---

### Task 4: `data-label` en `generatePartidos()` (partidos)

**Files:**
- Modify: `site/src/generate.ts` — función `generatePartidos()`
- Modify: `site/src/generate.test.ts`

**Step 1: Escribir tests que fallan**

Agregar al final de `site/src/generate.test.ts`:

```ts
import { generatePartidos } from './generate';

describe('generatePartidos()', () => {
  const matches = [{
    id: '1', home_team: 'Colombia', away_team: 'Brasil',
    kickoff_at: '2026-06-15T20:00:00Z', phase: 'group',
    group_name: 'A', home_score: null, away_score: null, status: 'scheduled'
  }];

  it('incluye data-label="Local"', () => {
    expect(generatePartidos(matches)).toContain('data-label="Local"');
  });

  it('incluye data-label="Resultado"', () => {
    expect(generatePartidos(matches)).toContain('data-label="Resultado"');
  });

  it('incluye data-label="Visitante"', () => {
    expect(generatePartidos(matches)).toContain('data-label="Visitante"');
  });

  it('incluye data-label="Fecha"', () => {
    expect(generatePartidos(matches)).toContain('data-label="Fecha"');
  });

  it('incluye data-label="Fase"', () => {
    expect(generatePartidos(matches)).toContain('data-label="Fase"');
  });
});
```

**Step 2: Verificar que los tests fallan**

```bash
cd site && npm test
```
Expected: 5 tests FAIL

**Step 3: Agregar `data-label` en `generatePartidos()`**

En la función `generatePartidos()`, cambiar el template del `<tr>` generado:

```ts
`<tr>
  <td data-label="Local">${m.home_team}</td>
  <td data-label="Resultado">${result}</td>
  <td data-label="Visitante">${m.away_team}</td>
  <td data-label="Fecha">${formatDate(m.kickoff_at)}</td>
  <td data-label="Fase">${phase}</td>
</tr>`
```

**Step 4: Verificar que los tests pasan**

```bash
cd site && npm test
```
Expected: todos los tests PASS

**Step 5: Commit**

```bash
rtk git add site/src/generate.ts site/src/generate.test.ts && rtk git commit -m "feat: add data-label to matches table for mobile"
```

---

### Task 5: `data-label` en `generateStats()`

**Files:**
- Modify: `site/src/generate.ts` — función `generateStats()`
- Modify: `site/src/generate.test.ts`

**Step 1: Escribir tests que fallan**

Agregar al final de `site/src/generate.test.ts`:

```ts
import { generateStats } from './generate';

describe('generateStats()', () => {
  const leaderboard = [{ user_id: '1', username: 'Alice', total_points: 10 }];
  const predictions = [{ points: 5 }, { points: 3 }, { points: 0 }];

  it('incluye data-label="Resultado"', () => {
    expect(generateStats(leaderboard, predictions)).toContain('data-label="Resultado"');
  });

  it('incluye data-label="Cantidad"', () => {
    expect(generateStats(leaderboard, predictions)).toContain('data-label="Cantidad"');
  });

  it('incluye data-label="%"', () => {
    expect(generateStats(leaderboard, predictions)).toContain('data-label="%"');
  });
});
```

**Step 2: Verificar que los tests fallan**

```bash
cd site && npm test
```
Expected: 3 tests FAIL

**Step 3: Agregar `data-label` en `generateStats()`**

En la función `generateStats()`, agregar `data-label` a cada `<td>` de las filas de la tabla:

```ts
`<tr><td data-label="Resultado">🎯 Marcador exacto (5pts)</td><td data-label="Cantidad">${exact}</td><td data-label="%">${pct(exact)}</td></tr>
<tr><td data-label="Resultado">✔️ Resultado + diferencia (4pts)</td><td data-label="Cantidad">${bonus}</td><td data-label="%">${pct(bonus)}</td></tr>
<tr><td data-label="Resultado">✔️ Solo resultado (3pts)</td><td data-label="Cantidad">${correct - bonus}</td><td data-label="%">${pct(correct - bonus)}</td></tr>
<tr><td data-label="Resultado">❌ Sin puntos (0pts)</td><td data-label="Cantidad">${zero}</td><td data-label="%">${pct(zero)}</td></tr>`
```

**Step 4: Verificar que todos los tests pasan**

```bash
cd site && npm test
```
Expected: todos los tests PASS (15 total)

**Step 5: Commit final**

```bash
rtk git add site/src/generate.ts site/src/generate.test.ts && rtk git commit -m "feat: add data-label to stats table for mobile"
```
