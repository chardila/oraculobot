# Text-to-SQL para preguntas históricas de Mundiales

## Contexto

El chat de preguntas (`/api/question`) hoy funciona pasando todo el contexto histórico
como texto en el system prompt (~6,600 tokens de HISTORY_CONTEXT + ~8,000 de calendario/polla).
Esto limita qué datos podemos incluir y tiene costo fijo por pregunta independientemente
de lo que se pregunte.

## Objetivo

Mover los datos históricos de Mundiales (1930–2022 + eliminatorias 2026) a tablas de
Supabase y enseñar al modelo a consultar esos datos con SQL generado dinámicamente.
Las preguntas sobre la polla (ranking, predicciones) siguen usando contexto en el prompt.

## Alcance — qué NO cambia

- Tablas de la polla (`matches`, `predictions`, `users`, `leagues`, etc.) — intocables.
- El flujo de preguntas sobre la polla (contexto en prompt, 1 llamada a DeepSeek).
- Toda la infraestructura del worker fuera de `handlers/web/question.ts`.

## Tablas nuevas en Supabase

```sql
wc_matches (
  id          serial primary key,
  year        int,           -- 2014, 2018, 2022, etc.
  tournament  text,          -- 'FIFA World Cup' | 'FIFA World Cup qualification'
  phase       text,          -- 'Group A', 'Round of 16', 'Final', etc.
  home_team   text,
  away_team   text,
  home_score  int,           -- null si no jugado aún
  away_score  int,
  home_ht     int,           -- marcador al descanso
  away_ht     int,
  match_date  date,
  ground      text           -- estadio
)

wc_goals (
  id        serial primary key,
  match_id  int references wc_matches(id),
  team      text,
  scorer    text,
  minute    int,
  penalty   boolean,
  own_goal  boolean
)

wc_teams (
  id            serial primary key,
  year          int,
  name          text,
  fifa_code     text,
  continent     text,
  confederation text,
  group_name    text
)

wc_stadiums (
  id        serial primary key,
  year      int,
  name      text,
  city      text,
  country   text,
  capacity  int
)
```

RLS habilitado en todas. Sin políticas (solo service role accede).

## Datos a cargar

| Fuente | Contenido | Filas estimadas |
|---|---|---|
| openfootball/worldcup.json (1930–2022) | Partidos, goles, equipos, estadios, grupos | ~5,400 |
| martj42/international_results results.csv | Eliminatorias 2026 (resultados) | ~901 |
| martj42/international_results goalscorers.csv | Goleadores eliminatorias 2026 | ~4,537 |
| **Total** | | **~10,800 filas (~2MB)** |

Script de carga: `WorldCup2026/load-wc-history.ts` (uno solo que descarga y carga todo).

## Flujo por tipo de pregunta

### Preguntas sobre la polla (sin cambios)
```
pregunta → DeepSeek (contexto polla en prompt) → respuesta
```

### Preguntas históricas de Mundiales
```
pregunta
  → DeepSeek: schema wc_* + few-shot examples + pregunta → SQL
  → worker: valida SQL (solo SELECT, solo tablas wc_*)
  → Supabase: ejecuta query
  → DeepSeek: pregunta + resultados SQL → respuesta en español
```

Si el SQL falla: reintentar una vez enviando el error. Si falla de nuevo: responder
"no pude obtener esa información".

### Detección del tipo de pregunta

El system prompt del paso 1 instruye al modelo a responder con `SQL: <query>` si necesita
datos históricos, o con la respuesta directa si puede contestar con el contexto de la polla
ya incluido. El worker detecta el prefijo `SQL:` para decidir el flujo.

## Seguridad

- Validación en worker antes de ejecutar: debe comenzar con `SELECT`, sin `;` múltiples,
  sin referencias a tablas fuera de `wc_matches`, `wc_goals`, `wc_teams`, `wc_stadiums`.
- Las tablas de la polla son invisibles para el modelo en este flujo.

## Costo estimado por pregunta

| Tipo | Tokens (antes) | Tokens (después) |
|---|---|---|
| Polla | ~8,000 | ~8,000 (sin cambio) |
| WC histórica | ~15,000 | ~4,000 |

## Script de carga de datos

`WorldCup2026/load-wc-history.ts`:
1. Descarga todos los JSON de openfootball (1930–2022) vía GitHub API
2. Descarga `results.csv` y `goalscorers.csv` de martj42
3. Inserta en las 4 tablas usando upsert (idempotente — se puede re-ejecutar)
4. Reporta filas insertadas por tabla

## Archivos a modificar/crear

```
supabase/migrations/014_wc_history_tables.sql   -- crea las 4 tablas
WorldCup2026/load-wc-history.ts                 -- script de carga
worker/src/handlers/web/question.ts             -- flujo text-to-SQL
worker/src/services/wc-sql.ts                   -- validación SQL + few-shot schema prompt
```
