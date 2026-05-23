# Design: Match Reminders for Web UI

**Date:** 2026-05-23  
**Status:** Approved

## Problem

Users forget to predict upcoming matches. We want to proactively surface unpredicted matches that are about to start (within 24 hours) so users are motivated to act before it's too late.

## Solution

Show an interstitial modal in the web UI (`jugar.html`) after login/session restore if there are upcoming matches (kick-off within 24h) the user hasn't predicted yet. Each match in the modal has a direct "Predecir" button that drops the user into the prediction flow for that specific match.

## Architecture

### New endpoint: `GET /api/reminders`

**File:** `worker/src/handlers/web/reminders.ts`  
**Registered in:** `worker/src/index.ts`

**Auth:** Required. Uses the existing `authenticate()` middleware — `user.id` is always taken from the verified JWT, never from query params or the request body. This prevents IDOR attacks where one user could fetch another user's reminder data.

**Query logic (via Supabase REST):**
```
matches
  WHERE match_time > now()
  AND match_time < now() + 24h
  AND id NOT IN (predictions WHERE user_id = <jwt_user_id>)
ORDER BY match_time ASC
```

**Response:**
```json
[
  {
    "id": "uuid",
    "home_team": "Colombia",
    "away_team": "Brasil",
    "match_time": "2026-05-24T15:00:00Z"
  }
]
```

Returns `[]` when no urgent matches exist. Never exposes other users' predictions.

**CORS:** Handled by existing `withCors()` middleware — same as all `/api/*` routes.

**Error handling:** Auth errors return 401/403. Supabase failures return 500. No sensitive information in error messages.

### Frontend changes: `site/jugar.html`

**Trigger:** After successful auth (login or session restore from localStorage), call `GET /api/reminders` before rendering the home screen.

**Modal behavior:**
- If response is empty (`[]`): skip modal, render home screen normally
- If response has ≥1 match: render modal as an overlay (semitransparent backdrop, centered card) on top of the not-yet-visible home screen
- Modal is not auto-dismissed — user must explicitly act

**Modal contents:**
- Title: "Tienes partidos próximos sin predecir"
- For each match: team names + formatted local time + "Predecir" button
- "Más tarde" button to dismiss the modal and proceed to the home screen

**On "Predecir" click:** Dismisses modal, enters the predict flow directly for that specific match (reuses existing predict flow entry point with the match pre-selected).

**On "Más tarde" click:** Dismisses modal, shows home screen normally.

**Token security:** The JWT is sent as `Authorization: Bearer <token>` in the fetch call, same as all other authenticated endpoints. The token is read from localStorage — no change to the existing auth pattern.

## Security checklist

- `user.id` is always extracted from the verified JWT server-side (no IDOR risk)
- No user-controlled input reaches the SQL query — match filtering is pure server-side date arithmetic
- CORS restricted to `WEB_ORIGIN` (existing middleware)
- Auth errors return generic messages (no information leakage)
- Rate limiting: handled by Cloudflare Workers edge (existing infrastructure)
- No new secrets or permissions required

## Out of scope

- Push notifications / Telegram reminders (Telegram is admin-only)
- Reminders for matches > 24h away
- Configurable threshold per user
