# Desglose de puntos en "Mis predicciones"

**Fecha:** 2026-06-12
**Estado:** aprobado

## Problema

La vista "Mis predicciones" muestra para cada partido terminado `Tu predicción: X-Y · Resultado: A-B · N pts`, pero no explica por qué se obtuvieron esos puntos. Los usuarios no pueden distinguir si ganaron puntos por marcador exacto, resultado correcto, diferencia de goles, o si fallaron completamente.

## Solución

Reemplazar `showMyPredictions()` en `site/jugar.html` con una vista rediseñada que muestra:
1. Un resumen general con totales y estadísticas
2. El historial de partidos terminados con desglose de puntos, paginado
3. Las predicciones pendientes

**Alcance:** solo `site/jugar.html`. Cero cambios en el worker o backend.

## Lógica de clasificación

`classifyPrediction(ph, pa, ah, aa)` espeja exactamente `calculatePoints()` de `worker/src/services/scoring.ts`:

| Condición | Emoji | Etiqueta | Puntos |
|-----------|-------|----------|--------|
| `ph===ah && pa===aa` | ⭐ | Marcador exacto | 5 |
| Resultado correcto + diferencia exacta | ✅ | Resultado correcto · Diferencia exacta | 4 |
| Solo resultado correcto | ✅ | Resultado correcto | 3 |
| Resultado incorrecto | ❌ | Resultado equivocado | 0 |

## Formato de mensajes

### Mensaje 1 — Resumen general (siempre primero)

```
📊 Mis predicciones

47 pts · 8 partidos terminados
⭐ Exactos: 2   ✅ Correctos: 4   ❌ Fallidos: 2

🕐 12 predicciones pendientes
```

"Correctos" agrupa los resultados de 3 pts (resultado correcto) y 4 pts (resultado correcto + diferencia exacta). No se separan en el resumen para mantenerlo compacto.

La línea `🕐 N predicciones pendientes` solo aparece si `pending > 0`. Si no hay pendientes, se omite.

Si no hay ningún terminado aún:
```
📊 Mis predicciones

0 pts · 0 partidos terminados

🕐 12 predicciones pendientes
```

Si no hay ninguna predicción: mensaje único `"Aún no tienes predicciones. Usa 🔮 Predecir para empezar."` y se omiten los demás mensajes.

### Mensaje 2 — Partidos terminados (página de 8, más recientes primero)

```
⭐ Francia vs España
   Tu pred: 2-1 · Resultado: 2-1
   Marcador exacto · 5 pts

✅ Brasil vs Argentina
   Tu pred: 2-1 · Resultado: 3-1
   Resultado correcto · Diferencia exacta · 4 pts

✅ Alemania vs Japón
   Tu pred: 1-0 · Resultado: 2-0
   Resultado correcto · 3 pts

❌ México vs Suiza
   Tu pred: 2-0 · Resultado: 0-1
   Resultado equivocado · 0 pts
```

Si quedan más partidos: botón `Ver más (N restantes)` que carga la siguiente página.
Si no hay terminados: omitir este bloque silenciosamente.

### Mensaje 3 — Predicciones pendientes (solo si existen)

```
🕐 Próximas con predicción

México vs Canadá (15 Jun) · 2-1
Portugal vs Marruecos (16 Jun) · 1-0
```

Si no hay pendientes: omitir silenciosamente.

## Funciones nuevas / modificadas

### `classifyPrediction(ph, pa, ah, aa)`
Función pura. Devuelve `{ emoji, label, points }`. Se define localmente en `jugar.html`.

### `showMyPredictions()` (reemplaza la existente)
Orquesta el flujo:
1. Fetch a `/api/my-predictions` (existente, sin cambios)
2. Separa en `finished` (estado `finished`, orden descendente por `kickoff_at`) y `pending` (estado `scheduled`, orden ascendente)
3. Renderiza mensaje de resumen
4. Llama `showFinishedPage(finished, 0)` si hay terminados
5. Renderiza pendientes si hay

### `showFinishedPage(finished, offset)`
Función nueva. Renderiza un bloque de 8 partidos desde `offset`. Si `offset + 8 < finished.length`, agrega botón `Ver más (N restantes)`.

## Edge cases

| Caso | Comportamiento |
|------|----------------|
| Sin ninguna predicción | Mensaje vacío, sin bloques adicionales |
| Solo pendientes (torneo recién iniciado) | Resumen con 0 terminados, solo bloque pendientes |
| Solo terminados (torneo finalizado) | Resumen sin línea de pendientes, solo historial |
| `points: null` en partido terminado | Calcular con `classifyPrediction()` localmente; si `actual_home/away` son `null` también, mostrar `pts pendientes` |
| Error de red | Mensaje `❌ Error al cargar predicciones` (comportamiento actual) |
| Más de 8 terminados | Paginación con botón `Ver más` |

## Testing

Verificación manual en el navegador:

1. Mix de terminados + pendientes: resumen correcto, orden correcto en ambos bloques
2. Paginación: botón `Ver más` aparece y desaparece correctamente
3. Los 4 tipos de clasificación muestran etiqueta y puntos correctos
4. Sin predicciones: solo el mensaje vacío
5. Solo pendientes: bloque de terminados omitido
6. `points: null`: fallback visible

`classifyPrediction()` es candidata a test unitario en `site/src/classify.test.ts` (mismos casos que `worker/tests/scoring.test.ts`), pero no es bloqueante para el merge.

## Lo que NO cambia

- El endpoint `/api/my-predictions` — sin cambios
- El worker — sin cambios
- El nombre del botón en el menú (`📋 Mis predicciones`) — sin cambios
- La navegación y el botón "Volver"
