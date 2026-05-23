# Datos históricos openfootball en DeepSeek

**Fecha:** 2026-05-17  
**Estado:** Aprobado

## Objetivo

Ampliar el system prompt de DeepSeek con datos históricos de los Mundiales 2014–2026 del repositorio público [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json), para poder responder preguntas sobre resultados históricos, goleadores, participaciones por equipo, estadios y confederaciones.

## Contexto

El handler actual (`worker/src/handlers/web/question.ts`) ya inyecta en el system prompt:
- Calendario completo del Mundial 2026 (del DB)
- Resultados recientes (del DB)
- Tabla de la polla (del DB)

Lo que no puede contestar hoy:
- ¿Cuántas veces ganó Argentina en un Mundial?
- ¿Quién fue el goleador del Mundial 2022?
- ¿Cuál es el historial entre Brasil y Alemania?
- ¿A qué confederación pertenece Marruecos?
- ¿Cuántos espectadores caben en el MetLife Stadium?

Además, `VENUE_CONTEXT` existe en `worldcup-venues.ts` pero no está siendo usado en el prompt.

## Archivos a descargar

De `raw.githubusercontent.com/openfootball/worldcup.json/master/{year}/{file}`:

| Archivo | Años |
|---|---|
| `worldcup.json` | 2014, 2018, 2022, 2026 |
| `worldcup.teams.json` | 2014, 2018 |
| `worldcup.teams_meta.json` | 2026 |
| `worldcup.stadiums.json` | 2014, 2018, 2026 |
| `worldcup.groups.json` | 2014, 2018, 2022 |
| `worldcup.standings.json` | 2014, 2018 |

Incluye goles minuto a minuto (nombre, minuto, penal, autogol) para habilitar preguntas de goleadores.

## Tamaño estimado

- Total archivos: ~118 KB → ~29,500 tokens adicionales en el prompt
- Costo DeepSeek-V3: ~$0.008/request en cache miss; el contenido estático se cachea entre requests
- Impacto en latencia: cero (datos estáticos importados como módulos ES)

## Arquitectura

### Script de descarga

`WorldCup2026/download-history.ts` — script one-shot que:
1. Descarga cada archivo de openfootball
2. Guarda en `worker/src/data/history/{year}-{filename}`
3. Se ejecuta manualmente: `cd WorldCup2026 && npx ts-node download-history.ts`

Los archivos se hacen commit al repo.

### Integración en question.ts

Se importan los archivos como módulos ES y se serializan a JSON compacto (sin pretty-print). Se agrega una nueva sección al system prompt:

```
DATOS HISTÓRICOS (Mundiales 2014–2026):
{json compacto de worldcup.json por año}

EQUIPOS Y CONFEDERACIONES 2026:
{teams_meta.json}

ESTADIOS SEDE:
{stadiums 2026 + VENUE_CONTEXT existente}
```

También se agrega el import de `VENUE_CONTEXT` desde `worldcup-venues.ts` que hoy está sin usar.

## Decisiones de diseño

- **Estático sobre dinámico:** Los datos históricos no cambian; no tiene sentido fetchear en runtime y agregar latencia.
- **Goles incluidos:** La diferencia de costo (~$0.006/request) no justifica excluir información que habilita una clase entera de preguntas.
- **2026 incluido:** El worldcup.json de 2026 tiene referencias cruzadas para la fase eliminatoria (ej. "W74") que el DB no almacena.
- **Sin pre-procesamiento:** Los archivos se usan tal como vienen de openfootball para simplificar el script y mantener todos los campos.
