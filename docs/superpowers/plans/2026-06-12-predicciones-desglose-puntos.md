# Desglose de Puntos en Mis Predicciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la vista "Mis predicciones" en `site/jugar.html` para mostrar un resumen de puntos y el desglose por partido (marcador exacto, resultado correcto, fallido), con paginación.

**Architecture:** Cambio puramente frontend en `site/jugar.html`. Se agregan tres helpers (`classifyPrediction`, `renderFinishedMatch`, `showFinishedPage`) y se reemplaza `showMyPredictions()`. El endpoint `/api/my-predictions` no cambia.

**Tech Stack:** JavaScript vanilla en jugar.html. Los datos ya vienen de `/api/my-predictions` con todos los campos necesarios (`predicted_home/away`, `actual_home/away`, `points`, `status`, `kickoff_at`).

---

## File Map

| Archivo | Acción |
|---------|--------|
| `site/jugar.html` | Modificar — reemplazar `showMyPredictions()` y agregar helpers |

---

## Task 1: Crear rama de feature

- [ ] **Crear rama**

```bash
git checkout -b feature/predicciones-desglose-puntos
```

Expected: `Switched to a new branch 'feature/predicciones-desglose-puntos'`

---

## Task 2: Reemplazar `showMyPredictions` con la nueva implementación

**Files:**
- Modify: `site/jugar.html` (sección `// ── Mis predicciones ──`, ~línea 691)

La lógica de clasificación espeja exactamente `calculatePoints()` de `worker/src/services/scoring.ts`:
- 5 pts: marcador exacto
- 4 pts: resultado correcto + misma diferencia de goles
- 3 pts: solo resultado correcto
- 0 pts: resultado equivocado

- [ ] **Abrir `site/jugar.html` y localizar el bloque a reemplazar**

Buscar el comentario `// ── Mis predicciones ──` (~línea 691). El bloque a reemplazar va desde ese comentario hasta el cierre de `showMyPredictions()` (~línea 722).

El bloque actual es:

```javascript
    // ── Mis predicciones ──
    async function showMyPredictions() {
      addUserMsg('📋 Mis predicciones');
      clearInputs();
      const loading = addBotMsg('⏳ Cargando tus predicciones...');
      try {
        const { predictions } = await api('/api/my-predictions');
        loading.remove();
        if (predictions.length === 0) {
          addBotMsg('Aún no tienes predicciones.\nUsa 🔮 Predecir para hacer tu primera.');
          showButtons([[backButton()]]);
          return;
        }
        const lines = predictions.map(p => {
          const match = `${p.home_team} vs ${p.away_team}`;
          const pred = `Tu predicción: ${p.predicted_home}-${p.predicted_away}`;
          if (p.status === 'finished') {
            const pts = p.points !== null ? `${p.points} pts` : 'pts pendientes';
            return `✅ ${match}\n   ${pred}\n   Resultado: ${p.actual_home}-${p.actual_away} · ${pts}`;
          }
          return `🕐 ${match} (${formatDate(p.kickoff_at)})\n   ${pred}`;
        });
        for (let i = 0; i < lines.length; i += 8) {
          addBotMsg(lines.slice(i, i + 8).join('\n\n'));
        }
      } catch (e) {
        loading.remove();
        addBotMsg(`❌ ${e.message}`);
      }
      showButtons([[backButton()]]);
    }
```

- [ ] **Reemplazar ese bloque con la nueva implementación**

Reemplazar con:

```javascript
    function classifyPrediction(ph, pa, ah, aa) {
      if (ph === ah && pa === aa) return { emoji: '⭐', label: 'Marcador exacto', points: 5 };
      const predResult = Math.sign(ph - pa);
      const actualResult = Math.sign(ah - aa);
      if (predResult !== actualResult) return { emoji: '❌', label: 'Resultado equivocado', points: 0 };
      if (Math.abs(ph - pa) === Math.abs(ah - aa)) return { emoji: '✅', label: 'Resultado correcto · Diferencia exacta', points: 4 };
      return { emoji: '✅', label: 'Resultado correcto', points: 3 };
    }

    function renderFinishedMatch(p) {
      if (p.actual_home === null) {
        return `${p.home_team} vs ${p.away_team}\n   Tu pred: ${p.predicted_home}-${p.predicted_away}\n   pts pendientes`;
      }
      const { emoji, label, points } = classifyPrediction(p.predicted_home, p.predicted_away, p.actual_home, p.actual_away);
      return `${emoji} ${p.home_team} vs ${p.away_team}\n   Tu pred: ${p.predicted_home}-${p.predicted_away} · Resultado: ${p.actual_home}-${p.actual_away}\n   ${label} · ${points} pts`;
    }

    function showFinishedPage(finished, offset) {
      const page = finished.slice(offset, offset + 8);
      addBotMsg(page.map(p => renderFinishedMatch(p)).join('\n\n'));
      const remaining = finished.length - (offset + 8);
      const btns = [];
      if (remaining > 0) {
        btns.push([{ label: `Ver más (${remaining} restantes)`, action: () => showFinishedPage(finished, offset + 8) }]);
      }
      btns.push([backButton()]);
      showButtons(btns);
    }

    // ── Mis predicciones ──
    async function showMyPredictions() {
      addUserMsg('📋 Mis predicciones');
      clearInputs();
      const loading = addBotMsg('⏳ Cargando tus predicciones...');
      try {
        const { predictions } = await api('/api/my-predictions');
        loading.remove();
        if (predictions.length === 0) {
          addBotMsg('Aún no tienes predicciones.\nUsa 🔮 Predecir para hacer tu primera.');
          showButtons([[backButton()]]);
          return;
        }
        const finished = predictions
          .filter(p => p.status === 'finished')
          .sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at));
        const pending = predictions
          .filter(p => p.status !== 'finished')
          .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));

        const totalPts = finished.reduce((sum, p) => sum + (p.points ?? 0), 0);
        const classified = finished
          .filter(p => p.actual_home !== null)
          .map(p => classifyPrediction(p.predicted_home, p.predicted_away, p.actual_home, p.actual_away).points);
        const exactos = classified.filter(pts => pts === 5).length;
        const correctos = classified.filter(pts => pts === 3 || pts === 4).length;
        const fallidos = classified.filter(pts => pts === 0).length;

        let summary = `📊 Mis predicciones\n\n${totalPts} pts · ${finished.length} partidos terminados`;
        if (finished.length > 0) {
          summary += `\n⭐ Exactos: ${exactos}   ✅ Correctos: ${correctos}   ❌ Fallidos: ${fallidos}`;
        }
        if (pending.length > 0) {
          summary += `\n\n🕐 ${pending.length} predicciones pendientes`;
        }
        addBotMsg(summary);

        if (finished.length > 0) {
          addBotMsg(finished.slice(0, 8).map(p => renderFinishedMatch(p)).join('\n\n'));
        }

        if (pending.length > 0) {
          const lines = pending.map(p =>
            `${p.home_team} vs ${p.away_team} (${formatDate(p.kickoff_at)}) · ${p.predicted_home}-${p.predicted_away}`
          );
          addBotMsg('🕐 Próximas con predicción\n\n' + lines.join('\n'));
        }

        const btns = [];
        if (finished.length > 8) {
          const remaining = finished.length - 8;
          btns.push([{ label: `Ver más (${remaining} restantes)`, action: () => showFinishedPage(finished, 8) }]);
        }
        btns.push([backButton()]);
        showButtons(btns);
      } catch (e) {
        loading.remove();
        addBotMsg(`❌ ${e.message}`);
        showButtons([[backButton()]]);
      }
    }
```

---

## Task 3: Verificación manual en el navegador

**Files:** ninguno (solo verificación)

- [ ] **Levantar el servidor de desarrollo**

```bash
cd site && npx http-server . -p 8080
```

O abrir `site/jugar.html` directamente en el navegador (requiere tener acceso a la API en producción o mock).

- [ ] **Verificar: usuario con mix de terminados + pendientes**

Navegar a "📋 Mis predicciones". Confirmar:
- Primer mensaje muestra total de puntos, conteo de terminados, y estadísticas (⭐/✅/❌)
- Segundo bloque muestra partidos terminados con etiqueta y puntos por partido (más recientes primero)
- Tercer bloque muestra predicciones pendientes en orden ascendente por fecha
- Botones correctos al final (solo "🏠 Menú principal" si ≤8 terminados)

- [ ] **Verificar: clasificación de puntos correcta**

Para un partido terminado, confirmar que cada tipo muestra la etiqueta correcta:
- `predicted=2-1, result=2-1` → `⭐ Marcador exacto · 5 pts`
- `predicted=2-1, result=3-2` → `✅ Resultado correcto · Diferencia exacta · 4 pts`
- `predicted=2-1, result=3-1` → `✅ Resultado correcto · 3 pts`
- `predicted=2-1, result=0-2` → `❌ Resultado equivocado · 0 pts`

- [ ] **Verificar: paginación (solo si hay más de 8 terminados)**

Si hay >8 partidos terminados: debe aparecer botón `Ver más (N restantes)`.
Al pulsarlo: se agrega un nuevo bloque de hasta 8 partidos. El botón desaparece si no quedan más.

- [ ] **Verificar: sin predicciones**

Con un usuario sin predicciones (o simulando `predictions: []`): debe aparecer solo el mensaje `"Aún no tienes predicciones. Usa 🔮 Predecir para hacer tu primera."` y el botón de volver.

- [ ] **Verificar: solo pendientes (sin terminados)**

Confirmar que no aparece el bloque de terminados. El resumen muestra `0 pts · 0 partidos terminados`.

---

## Task 4: Commit y PR

- [ ] **Commit del cambio**

```bash
git add site/jugar.html
git commit -m "feat: rediseñar mis predicciones con desglose de puntos por partido"
```

- [ ] **Push y abrir PR**

```bash
git push -u origin feature/predicciones-desglose-puntos
gh pr create --title "feat: desglose de puntos en Mis predicciones" --body "$(cat <<'EOF'
## Summary

- Reemplaza la vista plana de predicciones con un resumen de puntos + historial con desglose por partido
- Cada partido terminado muestra emoji + etiqueta del logro (Marcador exacto, Resultado correcto, Resultado equivocado) y los puntos obtenidos
- Paginación de 8 partidos por página con botón "Ver más"
- Pendientes separados del historial, ordenados por fecha ascendente
- Cero cambios en backend — solo `site/jugar.html`

## Test plan

- [ ] Usuario con mix de terminados + pendientes: resumen correcto, desglose visible, orden correcto
- [ ] Los 4 tipos de puntuación muestran etiqueta y puntos correctos
- [ ] Paginación: botón "Ver más" aparece/desaparece correctamente
- [ ] Sin predicciones: mensaje vacío + botón volver
- [ ] Solo pendientes: bloque de terminados omitido

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
