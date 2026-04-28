# Telegram Admin-Only Menu

**Date:** 2026-04-27

## Context

The Telegram user is exclusively the admin. They do not participate in the pool (no predictions, no ranking, no questions). The current main menu shows all user-facing buttons plus admin buttons, which is noisy and irrelevant for the admin's workflow.

## Goal

Show only the 4 administrative buttons when the admin opens the Telegram bot. Regular users (registered via web) see only the 5 user-facing buttons. No button overlap between roles.

## Design

Replace the single `buildButtons(admin: boolean)` function in `worker/src/handlers/menu.ts` with two explicit functions:

### `buildAdminButtons()`
```
[ ✅ Resultado | 🎟 Invitar ]
[ ➕ Partido   | 🏆 Crear polla ]
```

### `buildUserButtons()`
```
[ 🔮 Predecir | 📊 Ranking ]
[ 📅 Partidos | ❓ Pregunta ]
[ 🌐 Sitio ]
```

Both `showMainMenu` and the `menu:main` callback case select the appropriate function via `isAdmin ? buildAdminButtons() : buildUserButtons()`.

## Scope

- **Only file changed:** `worker/src/handlers/menu.ts`
- No changes to router, admin handlers, user handlers, or greeting text.

## Non-goals

- No new roles or permission levels
- No changes to user-facing flows
- No changes to the admin handler logic
