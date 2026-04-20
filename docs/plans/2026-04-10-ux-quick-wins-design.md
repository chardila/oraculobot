# UX Quick Wins — OraculoBot

**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** 6 targeted UX improvements across 3 handler files and the router

## Context

OraculoBot is a Telegram bot for a World Cup 2026 prediction game. Users make score predictions, view rankings, and ask natural language questions. An admin manages matches and results.

After a UX review of all interaction flows, several high-friction points were identified that could be resolved with minimal code changes — no schema migrations, no new tables, no architectural changes. This document captures the 6 approved quick wins.

---

## Approved Changes

### 1. Botones de marcador rápido en predicciones
**File:** `worker/src/handlers/prediction.ts`

When a user selects a match to predict, show an inline keyboard with common soccer scores in addition to the free-text prompt. Tapping a button saves the prediction immediately (same upsert logic). Typing a score continues to work as before.

**Buttons to show:**
```
[ 0-0 ]  [ 1-0 ]  [ 0-1 ]
[ 1-1 ]  [ 2-0 ]  [ 0-2 ]
[ 2-1 ]  [ 1-2 ]  [ 3-0 ]
[ 2-2 ]  [ 3-1 ]  [ ✏️ Otro ]
```

"Otro" does nothing — it's a visual hint that typing is still allowed. The callback_data for score buttons uses the format `predict_score:<match_id>:<home>-<away>`.

**State machine:** When a score button is tapped, handle it in the existing callback handler path (same place as `predict:<match_id>`), bypassing the `awaiting_prediction_score` conversation state entirely.

---

### 2. Mostrar predicción actual antes de sobreescribir
**File:** `worker/src/handlers/prediction.ts`

When prompting the user to enter/change a score, query the `predictions` table for an existing prediction from this user for this match. If found, prepend the current prediction to the message:

```
Tu predicción actual: Colombia 2 - 1 Brasil ✅

¿Quieres cambiarla?
```

If no existing prediction, show the normal prompt without this header.

**Query:** `SELECT home_score, away_score FROM predictions WHERE match_id = ? AND user_id = ?`

---

### 3. Advertencia de cierre próximo
**File:** `worker/src/handlers/prediction.ts`

After the user selects a match (before showing the score prompt), compute minutes until kickoff. Show a contextual warning:

- **> 30 min:** No warning, normal flow
- **≤ 30 min and > 0:** Append `⚠️ Cierra en X minutos` to the score prompt message
- **≤ 0 min:** Block as today ("⏱ Las predicciones para este partido ya cerraron")

The cutoff check already exists; this change only adds the warning band.

---

### 4. Fase/grupo en lista de partidos
**File:** `worker/src/handlers/matches.ts`

The `matches` table already has `phase` and `group_name` columns. Format each match line to include this context:

**Format:**
- Group stage: `Grupos • Grupo A | Colombia vs Brasil — 15 jun 18:00`
- Knockout: `Octavos | Alemania vs Francia — 28 jun 20:00`

Helper function: `formatMatchPhase(match)` → returns the prefix string.

---

### 5. Botones inline para fase en flujo admin
**File:** `worker/src/handlers/admin/match.ts`

In the `awaiting_match_phase` step, instead of asking the admin to type the phase, send an inline keyboard:

```
[ Grupos ]  [ Octavos ]
[ Cuartos ] [ Semis ]
[ Final ]
```

The `callback_data` values: `match_phase:grupos`, `match_phase:octavos`, etc. The callback handler sets the state to `awaiting_match_group` (if grupos) or creates the match directly.

This replaces the free-text step entirely — the bot no longer needs to validate the phase string against the allowed list.

---

### 6. TTL de conversación (4 horas)
**File:** `worker/src/router.ts`

When loading `conversation_state`, check if `updated_at` is older than 4 hours. If so:

1. Delete the stale state row from Supabase
2. Send: `"Tu sesión anterior expiró. ¿En qué puedo ayudarte?"`
3. Show the main menu

**Threshold:** 4 hours (configurable constant at top of file). No new DB column needed — `updated_at` already exists.

---

## Files Changed

| File | Changes |
|------|---------|
| `worker/src/handlers/prediction.ts` | Changes 1, 2, 3 |
| `worker/src/handlers/matches.ts` | Change 4 |
| `worker/src/handlers/admin/match.ts` | Change 5 |
| `worker/src/router.ts` | Change 6 |

No schema migrations required. No new environment variables.

---

## Verification

1. **Change 1:** Select a match to predict → score buttons appear → tap a button → "✅ Predicción guardada" without typing
2. **Change 2:** Make a prediction for a match → go back to predecir → select same match → see "Tu predicción actual: X-Y"
3. **Change 3:** (Hard to test without mocking time) — unit test with `kickoff_at` set to 15 min in future → warning appears
4. **Change 4:** Open "📅 Partidos" → each match shows its phase prefix
5. **Change 5:** Admin → ➕ Partido → enter teams + kickoff → phase buttons appear → tap "Grupos"
6. **Change 6:** Insert a `conversation_state` row with `updated_at` = 5 hours ago → send any message → menu appears with expiry notice

Run existing test suite after each change: `cd worker && npm test`
