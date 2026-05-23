# Question Logs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Registrar en Supabase cada pregunta que un usuario hace en el chat web (quién, qué y cuándo), como auditoría consultable desde el dashboard.

**Architecture:** Nueva tabla `question_logs` en Supabase. Un método `insertQuestionLog` en `SupabaseClient`. Una llamada fire-and-forget en `handleWebQuestion` después de validar la pregunta.

**Tech Stack:** Cloudflare Worker (TypeScript), Supabase REST API, Vitest.

---

### Task 1: Crear migración SQL

**Files:**
- Create: `supabase/migrations/011_question_logs.sql`

**Step 1: Crear el archivo de migración**

```sql
create table question_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references users(id),
  question    text not null,
  asked_at    timestamptz default now()
);
```

**Step 2: Aplicar la migración en Supabase**

Desde el MCP de Supabase o el dashboard, ejecutar el SQL anterior. Verificar que la tabla `question_logs` aparece en el schema.

**Step 3: Commit**

```bash
git add supabase/migrations/011_question_logs.sql
git commit -m "feat: add question_logs table migration"
```

---

### Task 2: Agregar `insertQuestionLog` a `SupabaseClient`

**Files:**
- Modify: `worker/src/supabase.ts` (al final de la clase, antes del cierre `}`)
- Test: `worker/tests/supabase.test.ts` (si existe) o crear prueba en el test suite más cercano

**Step 1: Agregar el método al final de la clase `SupabaseClient`**

Insertar antes del `}` de cierre de la clase en `worker/src/supabase.ts`:

```ts
async insertQuestionLog(userId: string, question: string): Promise<void> {
  await this.req<void>('question_logs', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, question }),
    headers: { 'Prefer': 'return=minimal' },
  });
}
```

**Step 2: Verificar compilación TypeScript**

```bash
cd worker && npx tsc --noEmit
```

Expected: sin errores.

**Step 3: Commit**

```bash
git add worker/src/supabase.ts
git commit -m "feat: add insertQuestionLog to SupabaseClient"
```

---

### Task 3: Llamar `insertQuestionLog` en el handler

**Files:**
- Modify: `worker/src/handlers/web/question.ts`

El lugar exacto es después de la validación de longitud (línea ~36) y antes de la llamada a `db.setQuestionsToday`.

**Step 1: Agregar la llamada fire-and-forget**

Después de la validación `body.question.length > 500`, agregar:

```ts
// fire-and-forget: no bloquea ni falla la petición si el log falla
db.insertQuestionLog(user.id, body.question).catch(() => {});
```

El bloque queda así en contexto:

```ts
if (body.question.length > 500) {
  return Response.json({ error: 'La pregunta no puede superar 500 caracteres' }, { status: 400 });
}

// fire-and-forget: no bloquea ni falla la petición si el log falla
db.insertQuestionLog(user.id, body.question).catch(() => {});

const today = new Date().toISOString().slice(0, 10);
```

**Step 2: Ejecutar todos los tests**

```bash
cd worker && npm test
```

Expected: 34 tests passing (ninguno roto).

**Step 3: Commit**

```bash
git add worker/src/handlers/web/question.ts
git commit -m "feat: log questions to question_logs table"
```

---

### Task 4: Push y verificación final

**Step 1: Deploy del worker**

```bash
cd worker && npm run deploy
```

**Step 2: Hacer una pregunta de prueba en el chat web**

Ir a `jugar.html` → login → Preguntar → escribir una pregunta de prueba.

**Step 3: Verificar en Supabase dashboard**

Ejecutar en el SQL editor:

```sql
select u.username, q.question, q.asked_at
from question_logs q
join users u on u.id = q.user_id
order by q.asked_at desc
limit 10;
```

Expected: aparece la pregunta de prueba con usuario y timestamp.

**Step 4: Push**

```bash
git push
```
