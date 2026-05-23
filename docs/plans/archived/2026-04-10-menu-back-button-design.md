# Menu Back Button — Design

**Date:** 2026-04-10

## Problem

When a user selects "Pregunta" or "Invitar" from the main menu, the bot sends a new plain-text message and leaves no clear path back to the menu. Other actions (Ranking, Partidos, Predecir) replace the menu message in-place, so the menu is always reachable.

## Solution

Apply the same pattern consistently:

- **"Invitar"** — edit the original menu message in-place (like Ranking/Partidos), showing the invite code with a "🏠 Menú principal" back button.
- **"Pregunta"** — multi-step async flow can't edit the original menu; instead, append a "🏠 Menú principal" inline button to the final answer message (and to the error message).

## Changes

### `worker/src/handlers/admin/invite.ts`

- Add `msgId: number` parameter to `generateInviteCode`.
- Replace `sendMessage` with `editMenu`, using buttons `[[{ text: '🏠 Menú principal', callback_data: 'menu:main' }]]`.

### `worker/src/handlers/menu.ts`

- Pass `msgId` when calling `generateInviteCode`.

### `worker/src/handlers/question.ts`

- In `handleQuestionText`, replace the final `sendMessage(answer)` with `sendMenu(answer, backButton)`.
- Replace the error `sendMessage` with `sendMenu(errorText, backButton)`.
- `backButton = [[{ text: '🏠 Menú principal', callback_data: 'menu:main' }]]`

## Back button behavior

`menu:main` already exists in `handleMenuCallback` and calls `editMenu` to replace the clicked message with the full main menu. No changes needed there.

## Out of scope

- No changes to "Predecir", "Ranking", "Partidos", or admin result/match flows.
