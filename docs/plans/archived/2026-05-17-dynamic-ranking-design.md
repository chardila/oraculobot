# Dynamic Ranking Page Design

**Date:** 2026-05-17  
**Status:** Approved

## Problem

`index.html` (the ranking page on GitHub Pages) is generated statically by `site/src/generate.ts`. When a new user registers, they don't appear on the leaderboard until the site is manually or automatically rebuilt. There is no trigger that fires a rebuild on registration.

## Solution

Convert `index.html` from a static leaderboard snapshot into a shell page that fetches live ranking data from `/api/ranking` at load time using the user's existing Supabase session.

## Design

### How it works

1. User opens `index.html`
2. Page loads a JS snippet that calls `sb.auth.getSession()` — reads the Supabase session already stored in localStorage by `jugar.html`
3. If no session → shows a link to `jugar.html` to log in
4. If session → fetches `WORKER_URL + /api/ranking` with `Authorization: Bearer {token}`
5. Renders the ranking table into a `#ranking-container` placeholder

### Auth approach

Reuses the Supabase JS SDK (same CDN script as `jugar.html`). No custom localStorage key needed — the SDK manages session storage under its own key and `getSession()` retrieves it transparently across pages on the same origin.

### Changes

**`site/src/generate.ts`**
- `generateIndex()` loses its `leagues` parameter — no longer needs leaderboard data
- Generates a static HTML shell with a `<div id="ranking-container">Cargando ranking...</div>` and an inline JS snippet containing hardcoded `SUPABASE_URL`, `SUPABASE_ANON`, and `WORKER_URL` constants (same values as in `jugar.html`)
- `main()` continues querying leaderboard for `stats.html`; just stops passing it to `generateIndex()`

**No changes to:**
- Worker / API handlers
- `partidos.html` or `stats.html` (still fully static)
- GitHub Actions workflow

### Supabase free tier impact

Negligible. Each ranking page load = 1 RPC call (~1KB response). For 20-50 participants, this is orders of magnitude below the 5GB/month egress limit.

## Out of scope

- Making `stats.html` dynamic (it depends on prediction points which only change when results are entered — rebuild-on-result already handles this correctly)
- Triggering rebuild on registration as a fallback
