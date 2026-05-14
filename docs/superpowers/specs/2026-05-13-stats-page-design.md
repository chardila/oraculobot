# Stats Page — Diseño

**Fecha:** 2026-05-13  
**Scope:** Mejorar `site/src/generate.ts` → función `generateStats()` y datos que recibe `main()`

---

## Objetivo

Reemplazar la sección de estadísticas básica (solo líder + conteos globales) por una página rica con cuatro secciones, mostrando progreso individual, evolución en el tiempo y partidos difíciles. Todo generado estáticamente en build time — sin backend en runtime.

---

## Arquitectura

### Datos adicionales a fetchear en `main()`

El generador actualmente pide `predictions` con solo `select: 'points'`. Se amplía para incluir:

```
predictions: select=points,user_id,match_id
matches: ya se fetcha completo (incluye id, kickoff_at, phase, home_team, away_team, home_score, away_score, status)
```

No se requieren migraciones nuevas. Toda la agregación ocurre en TypeScript en build time.

### Interfaz ampliada

```typescript
interface PredictionDetail {
  points: number | null;
  user_id: string;
  match_id: string;
}
```

### Firma de `generateStats()`

```typescript
function generateStats(
  leaderboard: LeaderboardRow[],         // ya existe
  predictions: PredictionDetail[],       // ampliada
  matches: VenueMatch[]                  // añadida
): string
```

---

## Secciones de la página

### 1. Resumen global (KPI cards)

Cuatro tarjetas en grid 4 columnas:

| KPI | Cálculo |
|-----|---------|
| Partidos jugados | `matches.filter(m => m.status === 'finished').length` |
| % Exactos (5 pts) | `exactos / total_resueltas * 100` |
| % Correctos (3–4 pts) | `correctos / total_resueltas * 100` |
| % Sin puntos (0 pts) | `ceros / total_resueltas * 100` |

`total_resueltas` = predicciones donde `points !== null`.

### 2. Evolución de puntos acumulados (Chart.js line chart)

- **Eje X:** partidos jugados (en orden cronológico por `kickoff_at`), solo los `finished`
- **Eje Y:** puntos acumulados por usuario
- **Datos:** para cada usuario, sumar puntos partido a partido en orden temporal
- **Render:** Top 5 usuarios (por total de puntos) con líneas de color + etiqueta al final. Resto de usuarios como líneas grises tenues sin etiqueta
- **Tecnología:** Chart.js cargado desde CDN (`https://cdn.jsdelivr.net/npm/chart.js`), datos embebidos como JSON inline en el HTML
- **Tooltips:** habilitados (comportamiento default de Chart.js), muestran nombre + puntos acumulados al momento

### 3. Desglose por participante (tabla)

Una fila por usuario, ordenada por total de puntos descendente. Columnas:

| Columna | Descripción |
|---------|-------------|
| # | Posición (medallas para top 3) |
| Participante | `username` |
| Pts | Total acumulado |
| 🎯 Exactos | Predicciones con `points === 5` |
| ✔️ Correctos | Predicciones con `points === 3 \|\| points === 4` |
| ❌ Ceros | Predicciones con `points === 0` |
| Promedio | `total_pts / partidos_predichos`, 1 decimal. Si `partidos_predichos === 0`, mostrar `—` |
| Participación | Barra proporcional + fracción `N/total_jugados` |

La barra de participación es CSS puro (`width: X%`), coloreada con el mismo color que la línea en la gráfica de evolución (top 5) o gris (resto).

### 4. Partidos más y menos predecibles (tabla)

Solo partidos con `status === 'finished'`. Para cada partido:

```
aciertos = predicciones de ese partido con points >= 3
total_pred = predicciones de ese partido con points !== null
pct = aciertos / total_pred * 100
```

Excluir partidos donde `total_pred === 0` (nadie predijo ese partido). Mostrar los **3 más fáciles** (mayor %) y los **3 más difíciles** (menor %) — total hasta 6 filas, separadas visualmente. Si hay menos de 3 en alguna categoría, mostrar los disponibles.

Columnas: Partido (`home vs away`), Fase, Resultado, % Aciertos, etiqueta emoji (😎 / 😱).

Si hay empate en porcentaje, ordenar por número absoluto de predicciones (más predicciones primero).

---

## Implementación — archivos afectados

| Archivo | Cambio |
|---------|--------|
| `site/src/generate.ts` | Ampliar `Prediction` interface, `generateStats()` firma y cuerpo, `main()` fetcha más campos de `predictions`, pasa `enrichedMatches` a `generateStats()` |
| `site/src/generate.test.ts` | Añadir / actualizar tests para `generateStats()` con fixture data |

No se tocan otros archivos. No se requieren migraciones.

---

## Restricciones

- El sitio es 100% estático: Chart.js se carga del CDN. Si el CDN no está disponible, la gráfica no renderiza (las otras 3 secciones no dependen de JS).
- Los colores de las líneas son fijos (array de 5 colores hardcodeados en el generador), asignados por posición en el ranking al momento de generar.
- Solo se muestran partidos con resultado (`status === 'finished'`). La sección de evolución crece a medida que avanza el torneo.
- El admin (filtrado por `ADMIN_TELEGRAM_ID`) ya es excluido del leaderboard; se excluye también del desglose por usuario y de la gráfica. Las predicciones del admin **sí** se incluyen en los cálculos de dificultad de partidos (sección 4), ya que representan votos válidos sobre los resultados.
- Las predicciones se fetcha globalmente (todas las ligas). El desglose por usuario y la gráfica usan solo los `user_id` que aparecen en el leaderboard filtrado, ignorando automáticamente usuarios de otras ligas o el admin.
