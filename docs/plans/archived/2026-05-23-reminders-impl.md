# Match Reminders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a modal in `jugar.html` after login when there are scheduled matches kicking off within 24h that the user hasn't predicted yet.

**Architecture:** New `GET /api/reminders` endpoint in the Cloudflare Worker fetches upcoming scheduled matches and the user's predicted match IDs (two lightweight Supabase REST queries), filters in-memory, and returns only unpredicted urgent matches. The frontend calls this endpoint after auth and renders a modal overlay if the list is non-empty; each match has a direct "Predecir" button that drops the user into the existing predict flow.

**Tech Stack:** TypeScript · Cloudflare Workers · Supabase REST (PostgREST) · Vitest · vanilla JS in jugar.html

---

### Task 1: Add `ReminderMatch` type to `types.ts`

**Files:**
- Modify: `worker/src/types.ts`

**Step 1: Add the type after `UserPredictionItem`**

Open `worker/src/types.ts` and after the `UserPredictionItem` interface (around line 120) add:

```typescript
export interface ReminderMatch {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd worker && npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
rtk git add worker/src/types.ts && rtk git commit -m "feat: add ReminderMatch type"
```

---

### Task 2: Add filtering logic + write its test

**Files:**
- Create: `worker/tests/handlers/reminders.test.ts`
- Create: `worker/src/handlers/web/reminders.ts` (stub with exported pure function)

The handler will contain a pure `filterUnpredicted` function that is easy to unit-test.

**Step 1: Create the stub handler with the exported pure function**

Create `worker/src/handlers/web/reminders.ts`:

```typescript
import type { Env, ReminderMatch } from '../../types';
import { SupabaseClient } from '../../supabase';
import { authenticate, AuthError } from '../../middleware/auth';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function filterUnpredicted(
  matches: ReminderMatch[],
  predictedIds: Set<string>,
  now: Date,
  windowMs = WINDOW_MS
): ReminderMatch[] {
  const cutoff = new Date(now.getTime() + windowMs);
  return matches.filter(m => {
    const kickoff = new Date(m.kickoff_at);
    return kickoff > now && kickoff <= cutoff && !predictedIds.has(m.id);
  });
}

export async function handleWebReminders(request: Request, env: Env): Promise<Response> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  let user;
  try {
    user = await authenticate(request, env, db);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() + WINDOW_MS).toISOString();

  const [upcomingMatches, predictions] = await Promise.all([
    db.req<ReminderMatch[]>('matches', {}, {
      status: 'eq.scheduled',
      kickoff_at: `gt.${now.toISOString()}`,
      select: 'id,home_team,away_team,kickoff_at',
      order: 'kickoff_at.asc',
      limit: '50',
    }),
    db.req<{ match_id: string }[]>('predictions', {}, {
      user_id: `eq.${user.id}`,
      select: 'match_id',
    }),
  ]);

  const predictedIds = new Set(predictions.map(p => p.match_id));
  const reminders = filterUnpredicted(upcomingMatches, predictedIds, now);

  return Response.json(reminders);
}
```

Note: `db.req` is a private method. You will need to make it `protected` or add a `query` helper in the next step.

**Step 2: Write the failing test**

Create `worker/tests/handlers/reminders.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { filterUnpredicted } from '../../src/handlers/web/reminders';
import type { ReminderMatch } from '../../src/types';

function match(id: string, hoursFromNow: number): ReminderMatch {
  const kickoff_at = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
  return { id, home_team: 'A', away_team: 'B', kickoff_at };
}

describe('filterUnpredicted', () => {
  const now = new Date();

  it('includes unpredicted match within 24h', () => {
    const matches = [match('m1', 10)];
    const result = filterUnpredicted(matches, new Set(), now);
    expect(result.map(m => m.id)).toEqual(['m1']);
  });

  it('excludes already-predicted match', () => {
    const matches = [match('m1', 10)];
    const result = filterUnpredicted(matches, new Set(['m1']), now);
    expect(result).toHaveLength(0);
  });

  it('excludes match kicking off in more than 24h', () => {
    const matches = [match('m1', 25)];
    const result = filterUnpredicted(matches, new Set(), now);
    expect(result).toHaveLength(0);
  });

  it('excludes match already started (kickoff in the past)', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const matches = [{ id: 'm1', home_team: 'A', away_team: 'B', kickoff_at: past }];
    const result = filterUnpredicted(matches, new Set(), now);
    expect(result).toHaveLength(0);
  });

  it('returns multiple matches sorted as-is', () => {
    const matches = [match('m1', 2), match('m2', 12), match('m3', 23)];
    const predicted = new Set(['m2']);
    const result = filterUnpredicted(matches, predicted, now);
    expect(result.map(m => m.id)).toEqual(['m1', 'm3']);
  });

  it('returns empty array when no matches', () => {
    expect(filterUnpredicted([], new Set(), now)).toEqual([]);
  });
});
```

**Step 3: Run the test — expect it to fail** (file exists but `req` access will cause compile issues)

```bash
cd worker && rtk vitest run tests/handlers/reminders.test.ts
```

**Step 4: Fix `req` visibility — make it `protected` in `supabase.ts`**

In `worker/src/supabase.ts` line 14, change:

```typescript
private async req<T>(
```
to:
```typescript
async req<T>(
```

(Making it public so the handler can call it directly, consistent with how the rest of the class is public.)

**Step 5: Run the test again — expect PASS**

```bash
cd worker && rtk vitest run tests/handlers/reminders.test.ts
```

Expected: 6 tests passing.

**Step 6: Commit**

```bash
rtk git add worker/src/handlers/web/reminders.ts worker/tests/handlers/reminders.test.ts worker/src/supabase.ts && rtk git commit -m "feat: add reminders handler with filterUnpredicted logic"
```

---

### Task 3: Register the route in `index.ts`

**Files:**
- Modify: `worker/src/index.ts`

**Step 1: Add the import** at the top of `worker/src/index.ts`, after the other web handler imports:

```typescript
import { handleWebReminders } from './handlers/web/reminders';
```

**Step 2: Register the route** inside the `if (pathname.startsWith('/api/'))` block, after the `my-predictions` route (around line 51):

```typescript
} else if (pathname === '/api/reminders' && method === 'GET') {
  response = await handleWebReminders(request, env);
```

**Step 3: Run all tests**

```bash
cd worker && rtk vitest run
```

Expected: all tests pass.

**Step 4: Commit**

```bash
rtk git add worker/src/index.ts && rtk git commit -m "feat: register GET /api/reminders route"
```

---

### Task 4: Add modal CSS to `jugar.html`

**Files:**
- Modify: `site/jugar.html`

**Step 1: Add the CSS** inside the `<style>` tag, after the `.menu-card.wide` rule (around line 81):

```css
/* Reminders modal */
#reminder-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 100; align-items: center; justify-content: center; padding: 1rem; }
#reminder-overlay.visible { display: flex; }
#reminder-modal { background: var(--c-surface); border-radius: var(--r-md); box-shadow: var(--shadow-md); max-width: 420px; width: 100%; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; max-height: 85vh; overflow-y: auto; }
#reminder-modal h2 { font-size: 1.1rem; font-weight: 700; margin: 0; }
#reminder-modal p { font-size: 0.875rem; color: var(--c-muted); margin: 0; }
.reminder-item { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 0.65rem 0; border-top: 1px solid var(--c-border); }
.reminder-match { display: flex; flex-direction: column; gap: 0.15rem; }
.reminder-match strong { font-size: 0.9rem; }
.reminder-match span { font-size: 0.78rem; color: var(--c-muted); }
.reminder-predict-btn { flex-shrink: 0; padding: 0.4rem 0.85rem; background: var(--c-primary); color: #fff; border: none; border-radius: var(--r-pill); font-size: 0.8rem; font-weight: 600; cursor: pointer; }
.reminder-predict-btn:hover { background: var(--c-primary-dark); }
#btn-reminder-dismiss { align-self: flex-end; background: none; border: none; color: var(--c-muted); font-size: 0.875rem; cursor: pointer; padding: 0.25rem 0; }
#btn-reminder-dismiss:hover { color: var(--c-text); }
```

**Step 2: Verify the page loads** by opening `site/jugar.html` in a browser (or just checking for parse errors).

**Step 3: Commit**

```bash
rtk git add site/jugar.html && rtk git commit -m "feat: add reminder modal CSS"
```

---

### Task 5: Add modal HTML to `jugar.html`

**Files:**
- Modify: `site/jugar.html`

**Step 1: Add the modal HTML** right after the closing `</div>` of `#chat-screen` (around line 158), before the `<script>` tag:

```html
<!-- Reminders modal -->
<div id="reminder-overlay">
  <div id="reminder-modal">
    <h2>⏰ Partidos por predecir</h2>
    <p>Estos partidos comienzan pronto y aún no has hecho tu predicción.</p>
    <div id="reminder-list"></div>
    <button id="btn-reminder-dismiss">Más tarde</button>
  </div>
</div>
```

**Step 2: Commit**

```bash
rtk git add site/jugar.html && rtk git commit -m "feat: add reminder modal HTML"
```

---

### Task 6: Add modal JS logic to `jugar.html`

**Files:**
- Modify: `site/jugar.html`

**Step 1: Add DOM refs** inside the `// ── DOM refs ──` section (after `btnLogout`):

```javascript
const reminderOverlay = document.getElementById('reminder-overlay');
const reminderList    = document.getElementById('reminder-list');
const btnReminderDismiss = document.getElementById('btn-reminder-dismiss');
```

**Step 2: Add the `checkReminders` function** right before `startConversation` (around line 379):

```javascript
function formatKickoff(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('es-CO', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function checkReminders() {
  try {
    const reminders = await api('/api/reminders');
    if (!Array.isArray(reminders) || reminders.length === 0) return;

    reminderList.innerHTML = '';
    reminders.forEach(match => {
      const item = document.createElement('div');
      item.className = 'reminder-item';
      item.innerHTML = `
        <div class="reminder-match">
          <strong>${match.home_team} vs ${match.away_team}</strong>
          <span>${formatKickoff(match.kickoff_at)}</span>
        </div>
        <button class="reminder-predict-btn" data-id="${match.id}"
          data-home="${match.home_team}" data-away="${match.away_team}">Predecir</button>
      `;
      reminderList.appendChild(item);
    });

    reminderList.querySelectorAll('.reminder-predict-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        reminderOverlay.classList.remove('visible');
        const matchId = btn.dataset.id;
        const homeTeam = btn.dataset.home;
        const awayTeam = btn.dataset.away;
        if (messages.children.length === 0) startConversation();
        startPredictForMatch({ id: matchId, home_team: homeTeam, away_team: awayTeam });
      });
    });

    reminderOverlay.classList.add('visible');
  } catch {
    // Silently ignore — reminders are non-critical
  }
}

btnReminderDismiss.addEventListener('click', () => {
  reminderOverlay.classList.remove('visible');
});
```

**Step 3: Call `checkReminders()` from `showChat()`**

Find the `showChat` function (around line 276). After the line `if (messages.children.length === 0) startConversation();`, add:

```javascript
checkReminders();
```

So it becomes:
```javascript
function showChat() {
  loginScreen.style.display = 'none';
  chatScreen.style.display  = 'flex';
  chatScreen.style.flexDirection = 'column';
  if (messages.children.length === 0) startConversation();
  checkReminders();
}
```

**Step 4: Add `startPredictForMatch` helper**

The existing `startPredict` function fetches all matches and then lets the user pick. We need a variant that jumps directly to the score-entry step for a specific match. Find the existing predict flow (around line 415) and add this helper just before `startPredict`:

```javascript
async function startPredictForMatch(match) {
  addUserMsg(`🔮 Predecir: ${match.home_team} vs ${match.away_team}`);
  clearInputs();
  chatState = { step: 'predict_score', context: { matchId: match.id, home: match.home_team, away: match.away_team } };
  addBotMsg(`Ingresa tu predicción para ${match.home_team} vs ${match.away_team}:`);
  showScoreInput(async () => {
    const h = parseInt(document.getElementById('score-home').value, 10);
    const a = parseInt(document.getElementById('score-away').value, 10);
    clearInputs();
    addUserMsg(`${h} - ${a}`);
    const loading = addBotMsg('⏳ Guardando...');
    try {
      await api('/api/predict', {
        method: 'POST',
        body: JSON.stringify({ match_id: match.id, home_score: h, away_score: a }),
      });
      loading.textContent = `✅ Predicción guardada: ${match.home_team} ${h} – ${a} ${match.away_team}`;
    } catch (e) {
      loading.textContent = '❌ ' + e.message;
    }
    appendBackButton();
  });
}
```

**Step 5: Verify the full page parses** — open `site/jugar.html` in a browser, log in, confirm:
- If there are matches within 24h without a prediction → modal appears
- "Predecir" on a match → modal closes, score entry appears
- "Más tarde" → modal closes, home screen visible
- If no urgent matches → modal never appears

**Step 6: Run worker tests to catch any regressions**

```bash
cd worker && rtk vitest run
```

Expected: all tests pass.

**Step 7: Commit**

```bash
rtk git add site/jugar.html && rtk git commit -m "feat: add reminders modal logic with direct predict flow"
```

---

## Security verification checklist

Before marking complete, verify:

- [ ] `user.id` in handler comes from `authenticate()` JWT, never from query params
- [ ] `db.req` calls use server-side filtering; no user input reaches the query string
- [ ] Modal "Predecir" buttons use `data-id` from server response — no eval, no innerHTML injection via match names (they use `dataset.*` not direct interpolation into event handlers)
- [ ] `api()` helper always sends `Authorization: Bearer <jwt>` header
- [ ] Error in `checkReminders()` is silently caught — no user-visible stack traces

---

## Manual test plan

1. Log in as a user who has **no predictions** and there is a match in the next 24h → modal appears with that match
2. Click "Predecir" on the match → modal closes, score input appears, submit → success message
3. Log in again → modal no longer appears (prediction now exists)
4. Log in as a user with **all matches predicted** → modal never appears
5. Open app when no matches are scheduled in the next 24h → modal never appears
6. Click "Más tarde" → modal closes, home screen is shown normally
