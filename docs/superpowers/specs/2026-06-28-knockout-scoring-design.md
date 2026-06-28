# Diseño: Sistema de Puntos Knockout 2026

**Fecha:** 2026-06-28
**Estado:** Implementado

## Contexto

Con el inicio de las rondas eliminatorias del Mundial 2026, se migra a un sistema de puntos que:
1. Premia más tipos de aciertos parciales (acertar goles de un equipo aunque el resultado esté mal)
2. Otorga más puntos en rondas avanzadas para que quienes van atrás puedan recuperar
3. No toca los puntos ya asignados en la fase de grupos

## Sistema de Puntos

### Fase de grupos (sin cambio)
- 5 pts: marcador exacto
- 3 pts: resultado correcto (ganador o empate)
- +1 pt: diferencia de goles correcta

### Fases eliminatorias — fórmula base × multiplicador

Todos los puntos se evalúan sobre el **marcador a 90 minutos** (no incluye tiempo extra ni penales).

**Componentes base:**

| Acierto | Puntos base |
|---|---|
| Resultado correcto (ganador o empate a 90') | +2 |
| Diferencia de goles correcta (requiere resultado ✓) | +1 |
| Goles del equipo local exactos | +1 |
| Goles del equipo visitante exactos | +1 |
| **Marcador exacto a 90'** | **= 5 base** |

**Multiplicadores:**

| Fase (DB) | ×Mult | Máx por partido |
|---|---|---|
| `treintaidosavos` | ×2 | 10 pts |
| `octavos` | ×4 | 20 pts |
| `cuartos` | ×6 | 30 pts |
| `semis` | ×8 | 40 pts |
| `tercer_lugar` | ×4 | 20 pts |
| `final` | ×10 | 50 pts |

**Total máximo eliminatorias:** ~590 pts vs grupos: 360 pts (eliminatorias valen ~3× más)

### Ejemplo

Partido de Cuartos: Brazil 2 - Argentina 1 (a 90 min, luego van a penales)
- Predijiste: 2-0

| Componente | Evaluación | Puntos |
|---|---|---|
| Resultado (local gana) | ✓ | +6 (=2×3) |
| Diferencia (1 ≠ 2) | ✗ | 0 |
| Goles local (2=2) | ✓ | +3 (=1×3) |
| Goles visitante (0≠1) | ✗ | 0 |
| **Total** | | **9 / 30 pts posibles** |

## Archivos Modificados

- `worker/src/services/scoring.ts` — `calculatePoints(phase?)` + `calculatePointsBreakdown(phase?)`
- `worker/src/handlers/admin/result.ts` — pasa `match.phase` al calcular
- `worker/src/handlers/admin/propose.ts` — pasa `match.phase` al calcular
- `worker/src/handlers/admin/recalculate.ts` — pasa `match.phase` al calcular
- `worker/src/handlers/web/my-predictions.ts` — devuelve `breakdown` por componente
- `worker/src/types.ts` — añade `phase` y `breakdown` a `UserPredictionItem`
- `worker/src/supabase.ts` — incluye `phase` en el select de predicciones
- `site/jugar.html` — muestra desglose en Mis predicciones para partidos knockout
- `worker/tests/scoring.test.ts` — 31 tests cubriendo grupos y todas las fases knockout
