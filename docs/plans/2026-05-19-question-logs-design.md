# Design: Log de preguntas del chat

## Context

Los usuarios del chat web pueden hacer hasta 20 preguntas por día al bot (DeepSeek). No existe registro de qué preguntas se hicieron, quién las hizo, ni cuándo. Se necesita un log simple para auditoría consultable directamente desde Supabase.

## Diseño

### Nueva tabla: `question_logs`

```sql
create table question_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references users(id),
  question    text not null,
  asked_at    timestamptz default now()
);
```

No se necesitan índices adicionales para el caso de uso de auditoría manual.

### Nuevo método en `SupabaseClient`

```ts
async insertQuestionLog(userId: string, question: string): Promise<void> {
  await this.req('question_logs', { method: 'POST', body: { user_id: userId, question } });
}
```

### Cambio en `handleWebQuestion`

Una llamada fire-and-forget después de validar la pregunta (antes de llamar a DeepSeek), para no bloquear la respuesta si falla:

```ts
// fire-and-forget: no bloquea ni falla la petición si el log falla
db.insertQuestionLog(user.id, body.question).catch(() => {});
```

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/011_question_logs.sql` | Nueva tabla (crear) |
| `worker/src/supabase.ts` | Método `insertQuestionLog` |
| `worker/src/handlers/web/question.ts` | Llamada fire-and-forget |

## Lo que NO cambia

- No hay endpoint de consulta (se consulta directo en Supabase dashboard)
- No hay UI de administración
- No afecta el flujo de preguntas existente (fire-and-forget)
- No afecta tests existentes
