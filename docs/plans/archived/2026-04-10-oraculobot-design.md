# OraculoBot — Diseño del Sistema
**Fecha:** 2026-04-10
**Proyecto:** Bot de predicciones del Mundial 2026 (Telegram + Web estática)

---

## Visión

App para amigos y familia donde puedan hacer predicciones de partidos del Mundial 2026, interactuar vía un bot de Telegram con menús inline, ver resultados y leaderboard en una web estática, y hacer preguntas en lenguaje natural sobre el torneo.

**Prioridades:** simplicidad extrema · costo ~0 USD · experiencia conversacional · solo español.

---

## Arquitectura general

```
Telegram
   │  webhook (HTTPS POST)
   ▼
Cloudflare Worker (oraculobot-worker)
   ├── Supabase REST API (lectura/escritura)
   ├── DeepSeek API (solo en flujo de pregunta)
   └── GitHub API → workflow_dispatch
                          │
                    GitHub Actions
                          │ lee Supabase, genera HTML
                          ▼
                    GitHub Pages (sitio estático)
```

| Capa | Rol |
|------|-----|
| Worker | Router de mensajes Telegram, validación de reglas, lógica de puntos |
| Supabase | Única fuente de verdad para usuarios, partidos, predicciones y puntos |
| GitHub Actions | Generador de HTML estático; se dispara cuando el admin confirma un resultado |
| GitHub Pages | Hosting del sitio; archivos HTML/CSS cacheados por CDN |
| DeepSeek | Responde preguntas en lenguaje natural con contexto extraído de Supabase |

---

## Reglamento de puntuación

| Condición | Puntos |
|-----------|--------|
| Marcador exacto | 5 |
| Resultado correcto (G/E/G) | 3 |
| Diferencia de gol correcta (sin acertar exacto) | +1 |
| Ninguna | 0 |

- Predicciones cierran **5 minutos antes del kickoff** de cada partido.
- Un usuario puede modificar su predicción hasta el cierre (upsert).

---

## Modelo de datos

```sql
users
  id              uuid PK
  telegram_id     bigint UNIQUE
  username        text
  is_admin        boolean DEFAULT false
  invite_code     text FK → invite_codes.code
  created_at      timestamptz

invite_codes
  code            text PK
  created_by      uuid FK → users.id
  max_uses        int DEFAULT 1
  use_count       int DEFAULT 0
  created_at      timestamptz

matches
  id              uuid PK
  home_team       text
  away_team       text
  kickoff_at      timestamptz
  phase           text  -- 'grupos', 'octavos', 'cuartos', 'semis', 'final'
  group_name      text  -- 'A'..'L', null en fase eliminatoria
  home_score      int   -- null hasta que el admin carga resultado
  away_score      int   -- null hasta que el admin carga resultado
  status          text  -- 'scheduled' | 'finished'

predictions
  id              uuid PK
  user_id         uuid FK → users.id
  match_id        uuid FK → matches.id
  home_score      int
  away_score      int
  points          int   -- null hasta que el partido termina
  created_at      timestamptz
  updated_at      timestamptz
  UNIQUE(user_id, match_id)

conversation_state
  telegram_id     bigint PK
  step            text   -- ej. 'awaiting_prediction_score'
  context         jsonb  -- ej. {"match_id": "..."}
  updated_at      timestamptz
```

**Notas:**
- Puntos calculados en el Worker al cargar resultado y persistidos en `predictions.points`.
- Leaderboard: `SELECT user_id, SUM(points) FROM predictions GROUP BY user_id`.
- `conversation_state` es efímero; se sobreescribe en cada paso del flujo.

---

## Interfaz del bot (menús inline)

Sin slash commands. Toda la navegación es por teclados inline en Telegram.

**Menú principal** (aparece ante cualquier mensaje no reconocido o al registrarse):
```
[ 🔮 Predecir ]  [ 📊 Ranking ]
[ 📅 Partidos ]  [ ❓ Pregunta ]
```

**Menú admin** (solo visible si `telegram_id == ADMIN_TELEGRAM_ID`):
```
[ 🔮 Predecir ]  [ 📊 Ranking ]
[ 📅 Partidos ]  [ ❓ Pregunta ]
[ ✅ Resultado ]  [ 🎟 Invitar ]
[ ➕ Partido ]
```

**Flujo de predicción:**
```
Usuario toca [🔮 Predecir]
Bot: lista de próximos partidos como botones inline
Usuario toca "🇨🇴 Colombia vs 🇧🇷 Brasil - 15 jun 18:00"
Bot: "¿Tu predicción para Colombia vs Brasil? Envía el marcador (ej: 2-1)"
Usuario: "2-1"
Bot: "✅ Guardado: Colombia 2 - Brasil 1"
```

**Flujo de resultado (admin):**
```
Admin toca [✅ Resultado]
Bot: lista de partidos 'scheduled' con kickoff pasado
Admin toca el partido
Bot: "¿Resultado final? Envía el marcador (ej: 2-1)"
Admin: "2-1"
Bot: calcula puntos → actualiza Supabase → dispara GitHub Actions
Bot: "✅ Colombia 2-1 Brasil. 5 usuarios predijeron. 2 marcador exacto. 1 resultado. 2 sin puntos."
```

**Flujo de registro:**
```
Usuario nuevo envía cualquier mensaje
Bot: "Bienvenido a OraculoBot. Envía tu código de invitación para registrarte."
Usuario: "ABC123"
Bot: valida código → crea usuario → muestra menú principal
```

---

## Seguridad del admin

- `ADMIN_TELEGRAM_ID` almacenado como variable de entorno en el Worker.
- El Worker verifica el `telegram_id` del remitente antes de mostrar o ejecutar cualquier acción de admin.
- El `telegram_id` de Telegram no puede ser falsificado.

---

## Sitio web estático

**Estructura:**
```
index.html          → leaderboard general
partidos.html       → resultados por fase/grupo
usuario/{id}.html   → predicciones y puntos de cada usuario
stats.html          → estadísticas globales
```

**Estadísticas mostradas:**
- Ranking con puntos totales, partidos predichos y % de aciertos
- Tabla de partidos por fase con resultado y predicciones de cada usuario
- % exactos, racha actual, partido más/menos acertado por el grupo

**Pipeline de regeneración:**
```
Worker (admin confirma resultado)
  └─► POST github.com API → workflow_dispatch (build.yml)
        │
  GitHub Actions:
    1. query Supabase REST → descarga todos los datos
    2. script Node.js genera archivos HTML
    3. push a rama gh-pages
        │
  GitHub Pages sirve el sitio (~1-2 min tras el resultado)
```

El Worker no espera confirmación del build (fire-and-forget). Si el Action falla, los datos en Supabase son correctos; el admin puede re-disparar desde GitHub.

---

## Integración DeepSeek

Solo se invoca cuando el usuario activa el flujo "❓ Pregunta".

**Estructura del prompt:**
```
Eres el asistente del torneo de predicciones del Mundial 2026 de un grupo de amigos.
Responde siempre en español, de forma breve y directa.

CONTEXTO ACTUAL:
- Fecha: {fecha}
- Leaderboard: {top 10 con puntos}
- Próximos partidos: {próximos 5}
- Resultados recientes: {últimos 5}
- Partidos pendientes: {N}

PREGUNTA DEL USUARIO:
{pregunta}
```

Contexto mínimo para mantener tokens bajos. Costo estimado < $0.01 USD/día con ~50 preguntas/día usando `deepseek-chat`.

---

## Variables de entorno del Worker

```
TELEGRAM_BOT_TOKEN
ADMIN_TELEGRAM_ID
SUPABASE_URL
SUPABASE_SERVICE_KEY
DEEPSEEK_API_KEY
GITHUB_PAT              # permisos mínimos: actions:write
GITHUB_REPO             # formato: owner/repo
INVITE_CODE_SECRET      # para firmar/validar códigos de invitación
```

---

## Manejo de errores

| Caso | Comportamiento |
|------|---------------|
| Predicción fuera de tiempo | "⏱ Las predicciones para este partido ya cerraron" — no persiste |
| Predicción duplicada | Upsert silencioso — el usuario actualiza su predicción |
| Resultado cargado dos veces | Worker verifica `status = 'finished'` — responde error, no recalcula |
| GitHub Actions falla | Fire-and-forget — datos en Supabase correctos, web desactualizada hasta re-run manual |
| DeepSeek no disponible | "No pude procesar tu pregunta, intenta de nuevo." — sin retry |
| Usuario sin registro | Cualquier interacción → solicita código de invitación |
| Código inválido/agotado | "Este código ya no es válido" — sin revelar si existió |
