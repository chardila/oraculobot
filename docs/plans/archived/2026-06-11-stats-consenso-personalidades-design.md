# Stats: Consenso por Partido y Personalidades

**Fecha:** 2026-06-11  
**Estado:** Aprobado

## Objetivo

Agregar dos nuevas secciones a `stats.html` que sean entretenidas para los participantes de la polla. Las secciones deben ser visualmente ligeras, mobile-friendly, y siempre visibles (sin acordeón).

## Orden final de la página stats.html

1. KPIs globales *(existente)*
2. **Consenso por partido** *(nuevo)*
3. **Personalidades** *(nuevo)*
4. Evolución de puntos *(existente)*
5. Desglose por participante *(existente)*
6. Dificultad de partidos *(existente)*

---

## Sección 1: Consenso por Partido

Por cada partido con `status = 'finished'`, una tarjeta que muestra:

- Equipos y resultado real
- El marcador más popular predicho por los participantes (y cuántos lo eligieron)
- Conteo de: exactos (5 pts) / resultado correcto (1-4 pts) / ceros (0 pts)
- Etiqueta `😱 Nadie lo vio venir` si nadie obtuvo exacto

**Mockup:**
```
🇲🇽 Mexico 2 - 0 South Africa 🇿🇦
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Predicción más popular: 2-1 (5 personas)
🎯 Exactos: 0   ✅ Correctos: 8   ❌ Ceros: 4
```

**Datos necesarios (por partido):**
- `matches`: home_team, away_team, home_score, away_score, phase, kickoff_at
- `predictions`: home_score, away_score, points (agrupado por match_id)

---

## Sección 2: Personalidades

Grid de tarjetas, una por usuario con predicciones en partidos ya jugados. Cada usuario recibe uno o más badges según su estilo de predicción.

| Badge | Nombre | Criterio |
|---|---|---|
| 🎯 | El Adivino | Más predicciones con 5 pts (exactas) |
| 😤 | El Atrevido | Mayor promedio de goles totales predichos (home + away) |
| 🛡️ | El Conservador | Menor promedio de goles totales predichos |
| 🎲 | El Único | Más veces que predijo un marcador diferente al de todos los demás |

**Reglas:**
- Si hay empate en un criterio, el badge lo comparten todos los empatados
- Usuarios sin predicciones en partidos jugados no aparecen
- Un usuario puede tener más de un badge

**Datos necesarios:**
- `predictions` JOIN `matches`: home_score, away_score, points, match status
- Agrupar por user_id para calcular promedios y conteos

---

## Implementación

- Todo se computa en `site/src/generate.ts` — consistente con el patrón existente
- Sin nuevas tablas, RPCs ni infraestructura
- El HTML sigue el design system existente (CSS variables, tarjetas `.card`, tipografía del sitio)
