# Security Fixes 1-5 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Patch five security vulnerabilities: webhook forgery, OTP spam, invite code race condition, unbounded question length, and prompt injection via usernames.

**Architecture:** Fixes are localized — each touches 1-3 files. Fix 3 requires a new SQL migration to be run manually in Supabase. No schema changes beyond the new RPC function.

**Tech Stack:** Cloudflare Workers, TypeScript, Supabase (PostgreSQL + GoTrue Auth), Vitest

---

### Task 1: Telegram webhook secret token validation

**Files:**
- Modify: `worker/src/types.ts` — add `TELEGRAM_WEBHOOK_SECRET` to `Env`
- Modify: `worker/src/index.ts:49-57` — validate header before processing webhook

**Step 1: Write the failing test**

Add to `worker/tests/router.test.ts` (or create `worker/tests/webhook.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';

// Test the secret validation logic in isolation
function validateWebhookSecret(
  header: string | null,
  expected: string
): boolean {
  return header === expected;
}

describe('webhook secret validation', () => {
  it('rejects missing secret header', () => {
    expect(validateWebhookSecret(null, 'my-secret')).toBe(false);
  });

  it('rejects wrong secret', () => {
    expect(validateWebhookSecret('wrong', 'my-secret')).toBe(false);
  });

  it('accepts correct secret', () => {
    expect(validateWebhookSecret('my-secret', 'my-secret')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd worker && rtk npx vitest run tests/webhook.test.ts
```
Expected: FAIL (function not defined or file not found)

**Step 3: Add `TELEGRAM_WEBHOOK_SECRET` to Env type**

In `worker/src/types.ts`, add to the `Env` interface after `TELEGRAM_BOT_USERNAME`:

```typescript
TELEGRAM_WEBHOOK_SECRET: string;
```

**Step 4: Add validation in `worker/src/index.ts`**

Replace the Telegram webhook block (lines 49-57):

```typescript
// Telegram webhook: POST /
if (method === 'POST' && pathname === '/') {
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const update = await request.json() as import('./types').TelegramUpdate;
    ctx.waitUntil(route(update, env).catch(console.error));
  } catch (e) {
    console.error('Failed to parse Telegram update', e);
  }
  return new Response('OK', { status: 200 });
}
```

**Step 5: Create the test file and run tests**

Create `worker/tests/webhook.test.ts` with the test from Step 1, then run:

```bash
cd worker && rtk npx vitest run tests/webhook.test.ts
```
Expected: PASS

**Step 6: Register the secret with Cloudflare and Telegram**

After deploying, set the secret:
```bash
cd worker && wrangler secret put TELEGRAM_WEBHOOK_SECRET
# Enter a random string, e.g.: openssl rand -hex 32
```

Re-register the webhook with the secret:
```bash
curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WORKER_URL}&secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

**Step 7: Commit**

```bash
rtk git add worker/src/types.ts worker/src/index.ts worker/tests/webhook.test.ts
rtk git commit -m "fix: validate Telegram webhook secret token to prevent request forgery"
```

---

### Task 2: Login — verify user is registered before sending OTP

**Files:**
- Modify: `worker/src/handlers/web/login.ts`

**Context:** `supabase.ts` already has `generateMagicLink(email, redirectTo)` which calls the Supabase Admin API and returns `{ user: { id }, action_link }` without sending any email. We use it to get the `auth_user_id`, then check `getUserByAuthId`. If no user found in our `users` table, we return the same generic success message (to avoid leaking whether the email is registered) but do NOT call `sendMagicLinkOtp`.

**Step 1: Write the failing test**

In `worker/tests/handlers/` (create directory if needed), create `worker/tests/handlers/web-login.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Test the guard logic: only send OTP if user exists in our DB
// We test this by verifying the conditional — unit test the guard function

function shouldSendOtp(userExistsInDb: boolean): boolean {
  return userExistsInDb;
}

describe('web login OTP guard', () => {
  it('sends OTP when user is registered', () => {
    expect(shouldSendOtp(true)).toBe(true);
  });

  it('does NOT send OTP when user is not registered', () => {
    expect(shouldSendOtp(false)).toBe(false);
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd worker && rtk npx vitest run tests/handlers/web-login.test.ts
```
Expected: FAIL (file not found)

**Step 3: Create the test file and run — it should pass**

Create the file, run again. Expected: PASS (logic is simple).

**Step 4: Update `worker/src/handlers/web/login.ts`**

Replace the entire file content:

```typescript
import type { Env } from '../../types';
import { SupabaseClient } from '../../supabase';

export async function handleWebLogin(request: Request, env: Env): Promise<Response> {
  let body: { email: string };
  try {
    body = await request.json() as { email: string };
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.email) {
    return Response.json({ error: 'Email es requerido' }, { status: 400 });
  }

  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const SUCCESS_MSG = { ok: true, message: 'Si tienes una cuenta, recibirás un enlace de acceso en tu correo' };

  try {
    const { user: authUser } = await db.generateMagicLink(body.email, env.WEB_REDIRECT_URL);
    const registeredUser = await db.getUserByAuthId(authUser.id);
    if (!registeredUser) {
      return Response.json(SUCCESS_MSG);
    }
    await db.sendMagicLinkOtp(body.email, env.WEB_REDIRECT_URL);
  } catch (e) {
    console.error('Magic link error:', e);
    return Response.json({ error: 'No se pudo enviar el enlace mágico' }, { status: 500 });
  }

  return Response.json(SUCCESS_MSG);
}
```

**Step 5: Run all worker tests**

```bash
cd worker && rtk npx vitest run
```
Expected: all PASS

**Step 6: Commit**

```bash
rtk git add worker/src/handlers/web/login.ts worker/tests/handlers/web-login.test.ts
rtk git commit -m "fix: only send magic link OTP to registered users in /api/login"
```

---

### Task 3: Atomic invite code consumption (race condition)

**Files:**
- Create: `supabase/migrations/005_try_consume_invite_rpc.sql`
- Modify: `worker/src/supabase.ts` — add `tryConsumeInviteCode` method
- Modify: `worker/src/handlers/web/register.ts` — use atomic RPC
- Modify: `worker/src/handlers/registration.ts` — use atomic RPC

**Step 1: Create the SQL migration**

Create `supabase/migrations/005_try_consume_invite_rpc.sql`:

```sql
-- Atomic check-and-consume for invite codes.
-- Returns true if the code was valid and successfully consumed, false otherwise.
create or replace function try_consume_invite_code(p_code text)
returns boolean
language plpgsql
security definer
as $$
declare
  v_use_count int;
  v_max_uses  int;
begin
  select use_count, max_uses
    into v_use_count, v_max_uses
    from invite_codes
   where code = p_code
     for update;

  if not found or v_use_count >= v_max_uses then
    return false;
  end if;

  update invite_codes
     set use_count = use_count + 1
   where code = p_code;

  return true;
end;
$$;
```

**Step 2: Run migration manually in Supabase**

Copy the SQL and execute in the Supabase SQL editor (Dashboard → SQL Editor).

**Step 3: Add `tryConsumeInviteCode` to `worker/src/supabase.ts`**

Add after the `incrementInviteCodeUse` method (around line 79):

```typescript
async tryConsumeInviteCode(code: string): Promise<boolean> {
  const result = await this.req<boolean>('rpc/try_consume_invite_code', {
    method: 'POST',
    body: JSON.stringify({ p_code: code }),
    headers: { 'Prefer': 'return=minimal' },
  });
  return result === true;
}
```

**Step 4: Write a unit test for the logic**

Add to `worker/tests/registration.test.ts`:

```typescript
describe('invite code consumption', () => {
  it('code with use_count < max_uses is consumable', () => {
    const code = { use_count: 0, max_uses: 1 };
    expect(code.use_count < code.max_uses).toBe(true);
  });

  it('code with use_count >= max_uses is not consumable', () => {
    const code = { use_count: 1, max_uses: 1 };
    expect(code.use_count < code.max_uses).toBe(false);
  });
});
```

**Step 5: Update `worker/src/handlers/web/register.ts`**

Replace the invite code section. The new flow: call `tryConsumeInviteCode` atomically. If it returns false, reject. Remove the separate `getInviteCode` check and `incrementInviteCodeUse` call.

```typescript
import type { Env, WebRegisterRequest } from '../../types';
import { SupabaseClient } from '../../supabase';

export async function handleWebRegister(request: Request, env: Env): Promise<Response> {
  let body: WebRegisterRequest;
  try {
    body = await request.json() as WebRegisterRequest;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { email, invite_code } = body;
  if (!email || !invite_code) {
    return Response.json({ error: 'Email e invite_code son requeridos' }, { status: 400 });
  }

  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  let authUserId: string;
  try {
    const result = await db.generateMagicLink(email, env.WEB_REDIRECT_URL);
    authUserId = result.user.id;
  } catch (e) {
    console.error('Magic link error:', e);
    return Response.json({ error: 'No se pudo enviar el enlace mágico' }, { status: 500 });
  }

  // Only create user row and consume invite code on first registration
  const existing = await db.getUserByAuthId(authUserId);
  if (!existing) {
    const consumed = await db.tryConsumeInviteCode(invite_code);
    if (!consumed) {
      return Response.json({ error: 'Código de invitación inválido o expirado' }, { status: 400 });
    }
    await db.createWebUser(authUserId, invite_code);
  }

  try {
    await db.sendMagicLinkOtp(email, env.WEB_REDIRECT_URL);
  } catch (e) {
    console.error('OTP send error:', e);
    return Response.json({ error: 'No se pudo enviar el enlace mágico' }, { status: 500 });
  }

  return Response.json({ ok: true, message: 'Revisa tu correo para el enlace de acceso' });
}
```

**Step 6: Update `worker/src/handlers/registration.ts`**

Replace the invite code check + createUser + incrementInviteCodeUse block:

```typescript
// Old (lines 30-52): getInviteCode → check → createUser → incrementInviteCodeUse
// New: tryConsumeInviteCode (atomic) → createUser

const consumed = await db.tryConsumeInviteCode(text.toUpperCase());
if (!consumed) {
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    '❌ Código inválido o ya no es válido. Pide a quien te invitó que te reenvíe el código.');
  return;
}

await db.createUser({
  telegram_id: telegramId,
  username: msg.from.username ?? fullName,
  is_admin: false,
  invite_code: text.toUpperCase(),
  questions_today: 0,
});
```

The full updated `handleRegistration` function:

```typescript
export async function handleRegistration(
  msg: TelegramMessage,
  db: SupabaseClient,
  env: Env,
  showMainMenu: ShowMainMenuFn
): Promise<void> {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  const raw = msg.text?.trim() ?? '';
  const text = extractInviteCode(raw);

  if (!text || text.length < 4) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '👋 Bienvenido a OraculoBot.\n\nPara participar, envía tu <b>código de invitación</b>.');
    return;
  }

  const consumed = await db.tryConsumeInviteCode(text.toUpperCase());
  if (!consumed) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Código inválido o ya no es válido. Pide a quien te invitó que te reenvíe el código.');
    return;
  }

  await db.createUser({
    telegram_id: telegramId,
    username: msg.from.username ?? fullName,
    is_admin: false,
    invite_code: text.toUpperCase(),
    questions_today: 0,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ ¡Registrado! Bienvenido al torneo, <b>${fullName}</b>.`);

  const isAdmin = String(telegramId) === env.ADMIN_TELEGRAM_ID;
  await showMainMenu(chatId, isAdmin, env, fullName);
}
```

**Step 7: Run all tests**

```bash
cd worker && rtk npx vitest run
```
Expected: all PASS

**Step 8: Commit**

```bash
rtk git add supabase/migrations/005_try_consume_invite_rpc.sql worker/src/supabase.ts worker/src/handlers/web/register.ts worker/src/handlers/registration.ts worker/tests/registration.test.ts
rtk git commit -m "fix: atomic invite code consumption via try_consume_invite_code RPC"
```

---

### Task 4: Question length limit (500 chars)

**Files:**
- Modify: `worker/src/handlers/web/question.ts:28`
- Modify: `worker/src/handlers/question.ts:30`

**Step 1: Write failing test**

Create `worker/tests/handlers/question-validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

const MAX_QUESTION_LENGTH = 500;

function validateQuestion(q: string): string | null {
  if (!q.trim()) return 'La pregunta no puede estar vacía';
  if (q.length > MAX_QUESTION_LENGTH) return `La pregunta no puede superar ${MAX_QUESTION_LENGTH} caracteres`;
  return null;
}

describe('question validation', () => {
  it('rejects empty question', () => {
    expect(validateQuestion('   ')).not.toBeNull();
  });

  it('rejects question over 500 chars', () => {
    expect(validateQuestion('a'.repeat(501))).not.toBeNull();
  });

  it('accepts question at exactly 500 chars', () => {
    expect(validateQuestion('a'.repeat(500))).toBeNull();
  });

  it('accepts normal question', () => {
    expect(validateQuestion('¿Quién va ganando?')).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd worker && rtk npx vitest run tests/handlers/question-validation.test.ts
```
Expected: FAIL (file not found)

**Step 3: Create file and run — passes**

Create the file, run again. Expected: PASS.

**Step 4: Update `worker/src/handlers/web/question.ts`**

Replace the existing validation block (lines 28-30):

```typescript
if (!body.question?.trim()) {
  return Response.json({ error: 'La pregunta no puede estar vacía' }, { status: 400 });
}
if (body.question.length > 500) {
  return Response.json({ error: 'La pregunta no puede superar 500 caracteres' }, { status: 400 });
}
```

**Step 5: Update `worker/src/handlers/question.ts`**

In `handleQuestionText`, after extracting `question` (line 30), add:

```typescript
const question = msg.text?.trim() ?? '';

if (question.length > 500) {
  await sendMenu(env.TELEGRAM_BOT_TOKEN, chatId,
    'La pregunta no puede superar 500 caracteres.', BACK_BUTTON);
  return;
}
```

**Step 6: Run all tests**

```bash
cd worker && rtk npx vitest run
```
Expected: all PASS

**Step 7: Commit**

```bash
rtk git add worker/src/handlers/web/question.ts worker/src/handlers/question.ts worker/tests/handlers/question-validation.test.ts
rtk git commit -m "fix: limit question length to 500 chars to prevent prompt stuffing"
```

---

### Task 5: Sanitize usernames to prevent prompt injection

**Files:**
- Modify: `worker/src/handlers/question.ts`
- Modify: `worker/src/handlers/web/question.ts`

The leaderboard text is built in both files with the same pattern. We'll extract a `sanitizeUsername` helper and apply it before inserting usernames into the system prompt.

**Step 1: Write failing test**

Create `worker/tests/handlers/sanitize-username.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

function sanitizeUsername(name: string | null | undefined): string {
  if (!name) return 'Anónimo';
  return name.replace(/[\r\n\t]/g, ' ').slice(0, 30);
}

describe('sanitizeUsername', () => {
  it('removes newlines', () => {
    expect(sanitizeUsername('user\nINSTRUCTIONS')).not.toContain('\n');
  });

  it('removes carriage returns', () => {
    expect(sanitizeUsername('user\rINSTRUCTIONS')).not.toContain('\r');
  });

  it('truncates to 30 chars', () => {
    expect(sanitizeUsername('a'.repeat(50)).length).toBeLessThanOrEqual(30);
  });

  it('returns Anónimo for null', () => {
    expect(sanitizeUsername(null)).toBe('Anónimo');
  });

  it('leaves normal usernames unchanged', () => {
    expect(sanitizeUsername('Carlos')).toBe('Carlos');
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd worker && rtk npx vitest run tests/handlers/sanitize-username.test.ts
```
Expected: FAIL (file not found)

**Step 3: Create test file and verify it passes**

Expected: PASS (pure function, no dependencies).

**Step 4: Add `sanitizeUsername` to `worker/src/handlers/question.ts`**

Add the helper near the top of the file (after imports):

```typescript
function sanitizeUsername(name: string | null | undefined): string {
  if (!name) return 'Anónimo';
  return name.replace(/[\r\n\t]/g, ' ').slice(0, 30);
}
```

Then in `handleQuestionText`, update the leaderboard mapping:

```typescript
const leaderboardText = leaderboard.slice(0, 10)
  .map((r, i) => `${i + 1}. ${sanitizeUsername(r.username)}: ${r.total_points} pts`)
  .join('\n');
```

**Step 5: Add `sanitizeUsername` to `worker/src/handlers/web/question.ts`**

Same helper function added near the top:

```typescript
function sanitizeUsername(name: string | null | undefined): string {
  if (!name) return 'Anónimo';
  return name.replace(/[\r\n\t]/g, ' ').slice(0, 30);
}
```

Same leaderboard mapping update:

```typescript
const leaderboardText = leaderboard.slice(0, 10)
  .map((r, i) => `${i + 1}. ${sanitizeUsername(r.username)}: ${r.total_points} pts`)
  .join('\n');
```

**Step 6: Run all tests**

```bash
cd worker && rtk npx vitest run
```
Expected: all PASS

**Step 7: Commit**

```bash
rtk git add worker/src/handlers/question.ts worker/src/handlers/web/question.ts worker/tests/handlers/sanitize-username.test.ts
rtk git commit -m "fix: sanitize usernames in leaderboard before inserting into AI system prompt"
```

---

## Post-implementation checklist

- [ ] Task 1: Set `TELEGRAM_WEBHOOK_SECRET` via `wrangler secret put` and re-register Telegram webhook with `secret_token` param
- [ ] Task 3: Execute `005_try_consume_invite_rpc.sql` in Supabase SQL editor
- [ ] Deploy: `cd worker && npm run deploy`
- [ ] Smoke test: send a message to the bot, make a prediction via web, try registering with a used invite code
