# Telegram Admin-Only Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single `buildButtons(admin)` function with two explicit functions so the admin sees only admin buttons and regular users see only user buttons.

**Architecture:** Export `buildAdminButtons` and `buildUserButtons` from `menu.ts`, update the two call sites inside the same file. No other files change.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Export the two button-builder functions and update call sites

**Files:**
- Modify: `worker/src/handlers/menu.ts`

**Step 1: Export the two new functions**

Replace the existing `buildButtons` function (lines 17–44) with:

```ts
export function buildAdminButtons(): Array<Array<{ text: string; callback_data?: string; url?: string }>> {
  return [
    [
      { text: '✅ Resultado', callback_data: 'menu:admin_result' },
      { text: '🎟 Invitar',   callback_data: 'menu:admin_invite' },
    ],
    [
      { text: '➕ Partido',    callback_data: 'menu:admin_match' },
      { text: '🏆 Crear polla', callback_data: 'menu:admin_league' },
    ],
  ];
}

export function buildUserButtons(): Array<Array<{ text: string; callback_data?: string; url?: string }>> {
  return [
    [
      { text: '🔮 Predecir', callback_data: 'menu:predict' },
      { text: '📊 Ranking',  callback_data: 'menu:ranking' },
    ],
    [
      { text: '📅 Partidos', callback_data: 'menu:matches' },
      { text: '❓ Pregunta', callback_data: 'menu:question' },
    ],
    [
      { text: '🌐 Sitio', url: 'https://chardila.github.io/oraculobot/' },
    ],
  ];
}
```

**Step 2: Update `showMainMenu`**

Replace `buildButtons(isAdminUser)` with:
```ts
isAdminUser ? buildAdminButtons() : buildUserButtons()
```

**Step 3: Update the `menu:main` case in `handleMenuCallback`**

Replace `buildButtons(admin)` with:
```ts
admin ? buildAdminButtons() : buildUserButtons()
```

---

### Task 2: Write and run tests

**Files:**
- Create: `worker/tests/handlers/menu.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { buildAdminButtons, buildUserButtons } from '../../src/handlers/menu';

describe('buildAdminButtons', () => {
  it('returns only admin actions', () => {
    const buttons = buildAdminButtons().flat();
    const labels = buttons.map(b => b.text);
    expect(labels).toContain('✅ Resultado');
    expect(labels).toContain('🎟 Invitar');
    expect(labels).toContain('➕ Partido');
    expect(labels).toContain('🏆 Crear polla');
  });

  it('does not include user-facing actions', () => {
    const buttons = buildAdminButtons().flat();
    const labels = buttons.map(b => b.text);
    expect(labels).not.toContain('🔮 Predecir');
    expect(labels).not.toContain('📊 Ranking');
    expect(labels).not.toContain('📅 Partidos');
    expect(labels).not.toContain('❓ Pregunta');
  });
});

describe('buildUserButtons', () => {
  it('returns only user-facing actions', () => {
    const buttons = buildUserButtons().flat();
    const labels = buttons.map(b => b.text);
    expect(labels).toContain('🔮 Predecir');
    expect(labels).toContain('📊 Ranking');
    expect(labels).toContain('📅 Partidos');
    expect(labels).toContain('❓ Pregunta');
  });

  it('does not include admin actions', () => {
    const buttons = buildUserButtons().flat();
    const labels = buttons.map(b => b.text);
    expect(labels).not.toContain('✅ Resultado');
    expect(labels).not.toContain('🎟 Invitar');
    expect(labels).not.toContain('➕ Partido');
    expect(labels).not.toContain('🏆 Crear polla');
  });
});
```

**Step 2: Run tests to verify they fail (functions don't exist yet)**

```bash
cd worker && npx vitest run tests/handlers/menu.test.ts
```
Expected: FAIL — `buildAdminButtons is not a function` (or similar)

**Step 3: Apply the implementation from Task 1, then run tests again**

```bash
cd worker && npx vitest run tests/handlers/menu.test.ts
```
Expected: PASS — 4 tests passing

**Step 4: Run full test suite to check for regressions**

```bash
cd worker && npm test
```
Expected: all tests pass

**Step 5: Commit**

```bash
rtk git add worker/src/handlers/menu.ts worker/tests/handlers/menu.test.ts
rtk git commit -m "feat: show only admin buttons to Telegram admin user"
```
