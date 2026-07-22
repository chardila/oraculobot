# Shutdown de infraestructura productiva — oraculobot

**Fecha:** 2026-07-22
**Motivo:** El Mundial 2026 finalizó; el proyecto ya no requiere servicios activos.

## Inventario

### Eliminado completamente

| Servicio | Qué es |
|---|---|
| Cloudflare Worker `oraculobot-worker` | Backend del bot y web API |
| Supabase proyecto | BD (predicciones, usuarios, historial WC) + Auth |
| GitHub Pages `chardila.github.io/oraculobot` | Sitio estático público |
| Telegram webhook | Bot deja de recibir mensajes |
| Workflow `check-results.yml` | Cron cada 30 min → football-data.org |
| Workflow `update-squads.yml` | Cron diario → Zafronix API |
| Workflow `build-site.yml` | Build en cada push a main |

### Conservado

| Recurso | Dónde |
|---|---|
| Código fuente completo | Repo `chardila/oraculobot` (archivado, read-only) |
| Dump final de datos | Repo `chardila/oraculobot-backup` |

### Sin acción necesaria

DeepSeek, football-data.org y Zafronix no tienen suscripciones activas — solo se cobran por uso y se apagan solos al eliminar el Worker.

## Estrategia: outside-in

Cortar primero lo que genera tráfico externo, exportar datos antes de eliminar Supabase, luego eliminar servicios, finalmente archivar el repo. Esto evita llamadas huérfanas (ej: cron llamando a un Worker ya eliminado).

## Fases

### Fase 1 — Cortar triggers externos (~5 min)

1. Eliminar webhook de Telegram:
   ```bash
   curl "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook"
   ```
2. Eliminar los 3 workflows del repo:
   ```bash
   rm .github/workflows/check-results.yml
   rm .github/workflows/update-squads.yml
   rm .github/workflows/build-site.yml
   ```
3. Commit y push — `build-site.yml` se dispara una última vez (inofensivo).

### Fase 2 — Exportar datos de Supabase (~10 min)

Ampliar `WorldCup2026/backup.ts` para incluir todas las tablas relevantes:

**Tablas de usuario:**
- `users`, `predictions`, `leagues`, `invite_codes`

**Tablas operacionales:**
- `matches`, `knockout_bracket`, `proposed_results`, `question_logs`

**Tablas WC históricas:**
- `wc_matches`, `wc_goals`, `wc_referees`, `wc_referee_appearances`
- `wc_bookings`, `wc_substitutions`, `wc_player_appearances`
- `wc_penalty_kicks`, `wc_group_standings`, `wc_award_winners`
- `wc_standings_2026`, `wc_squads_2026`, `wc_coaches_2026`
- `wc_teams`, `wc_stadiums`

Correr localmente:
```bash
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx WorldCup2026/backup.ts
```

Push manual del directorio `backup-output/YYYY-MM-DD/` al repo `chardila/oraculobot-backup`.

### Fase 3 — Eliminar servicios (~10 min, en dashboards)

1. **Cloudflare Worker:**
   ```bash
   cd worker && npx wrangler delete
   ```
2. **Supabase:** Dashboard → proyecto → Settings → General → Delete project
3. **GitHub Pages:** Repo Settings → Pages → Source → disable

### Fase 4 — Archivar repo (~1 min)

```bash
gh repo archive chardila/oraculobot
```

El repo queda read-only permanentemente. El repo `chardila/oraculobot-backup` no se archiva (puede necesitar commits manuales futuros si se requiere restaurar algo).

## Orden crítico

```
deleteWebhook → rm workflows → push
  → ampliar backup.ts → correr local → push backup-repo
    → wrangler delete → Supabase delete → Pages disable
      → gh repo archive
```

No eliminar Supabase antes de completar Fase 2. No archivar el repo antes de completar Fase 3.
