# CAMEVO — Registro de Cambios (Changelog)

Este documento registra la evolución de las **decisiones de documentación y alcance** del proyecto (no del código — eso se rastrea con Git, ver `05-estructura-repositorio.md`). Sigue el estándar [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/): cada versión agrupa cambios en `Added` (agregado), `Changed` (modificado) y `Removed` (excluido/retirado).

Cada entrada indica qué documento(s) se vieron afectados, para poder rastrear la versión de cada archivo individual.

---

## [v0.10.2] — Nota de cierre de Fase 4 en el roadmap

**Documentos afectados:** `04-roadmap-fases.md` (v1.2 → v1.3)

### Added
- Sección "Fase 4": nota de cierre con RFs cubiertos (RF-014, RF-015 activos solo en
  "Rápida"; RF-018 no implementado), el hallazgo de aislamiento de mecanismos (ningún
  mecanismo por separado produce extinción; solo la combinación), y la conexión con deuda
  de extinción vía la comparación con/sin capacidad adaptativa de partida.

**Motivo:** igual que v0.9.1 — el cierre de fase (v0.10.0) no tuvo cambio de documento
en sí mismo ("Documentos afectados: ninguno"), pero la nota de cierre agregada a
04-roadmap-fases.md sí es un cambio de contenido real que merece su propio registro.

---

## [v0.10.1] — Corrección de la convención de versionado: MAJOR es el primer despliegue real

**Documentos afectados:** `CHANGELOG.md` (esta misma convención de versionado, sección final)

### Changed
- La convención decía que MAJOR (`v1.x.x`) se reserva para "cuando el proyecto pase de fase
  de documentación a desarrollo activo (fin de Fase 0)" — ese momento ya había pasado hace
  varias fases (los cierres de Fase 1/2/3 se registraron como MINOR: v0.7.0, v0.8.0,
  v0.9.0), dejando la convención escrita inconsistente con la práctica real. Se corrige:
  MAJOR queda reservado para el primer despliegue real en producción
  (`camevo.ibsen-soto.pro` sirviendo tráfico real, fin de la Fase 5).
- Se extiende la "Excepción declarada" (v0.7.0) para aclarar explícitamente que los cierres
  de fase seguirán registrándose como MINOR hasta ese punto, no solo hasta v0.9.0.

**Motivo:** detectado al preparar el cierre de la Fase 4 — no tenía sentido seguir
incrementando MINOR por cada fase mientras la convención escrita decía que ya debería
haber ocurrido un MAJOR. Se corrige la convención hacia adelante; no se renumera el
historial ya publicado (v0.1.0 a v0.10.0 se mantienen exactamente como están).

---

## [v0.10.0] — Cierre de Fase 4: pool de CPU y eventos catastróficos, solo en "Rápida"

**Documentos afectados:** ninguno directamente — la Fase 4 implementó RF-014 (reducción del
pool de CPU global) y RF-015 (eventos catastróficos periódicos). RF-018 (mutación atada a
un parámetro de estrés ambiental) no se implementó — prioridad C, no bloqueante, tal como
estaba previsto en `02-requisitos.md`.

Decisión de diseño: RF-014/RF-015 quedan activos EXCLUSIVAMENTE en el preset de velocidad
climática "Rápida" — medido, antes de fijar los parámetros finales, que aplicarlos incluso
con límites suaves a "Lenta"/"Moderada" alteraba de forma significativa el fitness que la
Fase 3 ya había validado y cerrado (v0.9.0). Esto preserva intactos esos números.

Hallazgo empírico central de la fase (evidencia completa en
`apps/api/test/simulation/collapse-mechanism-isolation.test.ts`, 25 casos):

- Ni el pool de CPU reducido (`[0.01, 0.1]`) ni los eventos catastróficos (severidad 0.9
  cada 10 generaciones), por separado, producen extinción en 1500 generaciones — ambos
  empujan a la población cerca del borde, pero siempre se recupera. La extinción emerge
  únicamente de la COMBINACIÓN de ambos mecanismos, no de que cualquiera por sí solo sea
  letal.
- El tiempo hasta la extinción depende de la capacidad adaptativa con la que parte la
  población: sin ninguna ventaja adaptativa, muere en el primer evento catastrófico exacto
  (generación 10, 5/5 semillas); con una ventaja adaptativa de partida, sobrevive entre 3 y
  13 veces más (generaciones 30-130, 5/5 semillas) antes de sucumbir igual. Esto conecta
  directamente con el concepto de deuda de extinción ya citado en `01-vision-general.md`
  §9: la población puede estar condenada mucho antes de llegar a cero, y la adaptación
  compra tiempo, no garantiza escapar indefinidamente.

Marcador de cierre de fase (ver la excepción de versionado extendida en v0.10.1), no un
cambio de documentación en sí mismo salvo por el hallazgo registrado aquí.

---

## [v0.9.1] — Notas de cierre de Fase 1/2/3 en el roadmap

**Documentos afectados:** `04-roadmap-fases.md` (v1.1 → v1.2)

### Added
- Sección "Fase 1": nota de cierre con RFs cubiertos y verificación empírica (dos caminos
  evolutivos: acortamiento de genoma y resolución de tarea).
- Sección "Fase 2": nota de cierre con RFs cubiertos y la deuda técnica que quedó pendiente
  (`packages/shared-types` sin crear, `apps/web` sin tests).
- Sección "Fase 3": nota de cierre con RFs cubiertos, el hallazgo del multiplicador
  climático estadísticamente invisible y su corrección, la aclaración de variación
  genética en pie, y la deuda técnica pendiente (RF-025 sin comparar corridas históricas,
  sin colapso poblacional real).

**Motivo:** ninguna de las tres fases tenía una nota de cierre en el roadmap — quedaban
como si todavía estuvieran en curso. Se agregan las tres juntas, con el mismo formato,
para que la Fase 3 no introdujera un formato sin precedente en el propio documento.

---

## [v0.9.0] — Cierre de Fase 3: velocidad climática, diversidad y comparación

**Documentos afectados:** ninguno directamente — la Fase 3 implementó control de velocidad
e intensidad del cambio climático, diversidad genética, comparación de corridas en
paralelo y el panel explicativo según lo especificado (RF-012, RF-013, RF-021, RF-025
parcial, RF-026). La única aclaración de alcance que produjo (variación genética en pie)
se documenta por separado en v0.8.2.

Marcador de cierre de fase, no un cambio de documentación en sí mismo.

---

## [v0.8.2] — Aclaración sobre variación genética en pie (Fase 3)

**Documentos afectados:** `01-vision-general.md` (v1.1 → v1.2)

### Added
- Sección 9 (Referencias conceptuales): nota sobre variación genética en pie (*standing genetic variation*), conectando la decisión de implementación de la Fase 3 (sembrar un ancestro ya adaptado, en vez de depender de mutación nueva en tiempo real) con el concepto real de biología de la conservación.

**Motivo:** al implementar el criterio de cierre de la Fase 3 (rescate evolutivo vs. deuda de extinción observables en un tiempo de corrida razonable), se decidió sembrar la población con un organismo que ya resuelve una tarea lógica desde la generación 0. Esto cambia qué prueba exactamente el demo (selección sobre variación ya presente, no aparición de mutación nueva bajo presión climática) y se decidió documentarlo explícitamente en vez de dejarlo implícito solo en comentarios de código.

---

## [v0.8.1] — RF-019: aclarado como multiplicador oscilante, no agotamiento real (Fase 2)

**Documentos afectados:** `02-requisitos.md` (v1.1 → v1.2)

### Changed
- RF-019: se agrega nota de implementación aclarando que el "suministro por recurso" se
  resuelve como multiplicador de recompensa oscilante (tendencia + varianza), no como
  agotamiento real por consumo poblacional. Queda marcado como parcialmente resuelto.

**Motivo:** al implementar climate/policy en la Fase 2, un modelo de agotamiento real por
consumo resultó mayor alcance del necesario para demostrar el mecanismo climático central
del proyecto (RF-011). La aclaración existía solo en comentarios de código y en el reporte
de cierre de la Fase 2 — nunca había llegado al documento de requisitos versionado.

---

## [v0.8.0] — Cierre de Fase 2: climate/policy, API y persistencia

**Documentos afectados:** ninguno directamente — la Fase 2 implementó climate/policy,
api/rest, api/ws, persistence/repository y el frontend mínimo según lo especificado
(RF-010, RF-011, RF-019 parcial, RF-030, RF-020, RF-022). La única aclaración de alcance
que produjo (RF-019) se documenta por separado en v0.8.1.

Marcador de cierre de fase, no un cambio de documentación en sí mismo.

---

## [v0.7.0] — Cierre de Fase 1: motor de evolución digital

**Documentos afectados:** ninguno.

Marcador de cierre de fase, no un cambio de documentación: la Fase 1 implementó el motor
(engine/organism, engine/population, engine/tasks, simulation/orchestrator) exactamente
según lo ya especificado en la Fase 0 (RF-001 a RF-009), sin requerir ningún cambio de
alcance ni de arquitectura documentada. El detalle de la implementación se rastrea en git
(apps/api/), no aquí — ver 05-estructura-repositorio.md.

---

## [v0.6.0] — Estructura de repositorio actualizada

**Documentos afectados:** `05-estructura-repositorio.md` (v1.0 → v1.1)

### Changed
- Árbol de carpetas: se agrega `docs/CHANGELOG.md` a la documentación versionada.
- `apps/web/src/components/organism-detail/`: nuevo componente para la vista de organismo individual (RF-027).
- Comentarios de `engine/population`, `engine/tasks`, `climate/policy`, `simulation/orchestrator` y `api/rest` actualizados para reflejar sembrado multi-ancestro, colocación de descendencia, recursos por tarea, gestión de semilla y el endpoint de detalle de organismo.
- `packages/shared-types`: se aclara que también cubre el contrato de detalle de organismo.

**Motivo:** mantener el árbol de carpetas consistente con la arquitectura actualizada en v0.5.0.

---

## [v0.5.0] — Arquitectura actualizada según refinamiento de requisitos

**Documentos afectados:** `03-arquitectura.md` (v1.0 → v1.1)

### Changed
- `engine/population`: ahora responsable de sembrado múltiple de ancestros (RF-008) y modo de colocación de descendencia (RF-009).
- `engine/tasks` y `climate/policy`: rediseñados para manejar recursos individuales por tarea con suministro propio (RF-019), en vez de un pool de CPU único.
- `simulation/orchestrator`: se documenta explícitamente la gestión interna de la semilla (modo reproducible/experimental, RF-007).
- `api/rest`: se agrega endpoint de detalle de organismo bajo demanda para servir RF-027 sin sobrecargar el streaming en vivo.
- Flujo de datos: se añade la sección 4.1 describiendo el flujo bajo demanda para el detalle de organismo.
- Tabla de decisiones de diseño: se agregan dos filas nuevas (recursos por tarea vs. pool único; snapshot liviano + detalle bajo demanda) y se elimina la mención a fragmentación/gradiente espacial (ya excluidos desde v0.2.0) como ejemplo de extensión del módulo climático.

**Motivo:** mantener la arquitectura consistente con los requisitos refinados en v0.4.0 tras la revisión de Avida-ED.

---

## [v0.4.0] — Refinamiento de requisitos tras revisión de Avida-ED

**Documentos afectados:** `02-requisitos.md` (v1.0 → v1.1)

### Added
- **RF-008**: soporte para múltiples organismos ancestrales simultáneos al iniciar una corrida.
- **RF-009**: modo de colocación de la descendencia (cerca del padre / aleatorio en la grilla).
- **RF-019**: sistema de recursos por tarea con suministro configurable (ilimitado/limitado), refinando RF-006 y RF-014.
- **RF-027**: vista de organismo individual (genoma, tareas resueltas, fitness).

### Changed
- **RF-006**: se especifica una jerarquía de dificultad graduada en las recompensas por tarea (fácil ×2 → muy difícil ×16).
- **RF-007**: se reemplaza la exposición directa de un número de semilla por un modo de repetibilidad de dos opciones (*reproducible* / *experimental*), más usable para el público objetivo.
- **RNF-003**: reformulado para ser consistente con el nuevo RF-007.

**Motivo:** revisión directa de la interfaz de Avida-ED (versión educativa oficial de Avida), que expone estos mecanismos como configuración estándar y aporta valor pedagógico de bajo costo de implementación.

---

## [v0.3.0] — Reincorporación de eventos catastróficos

**Documentos afectados:** `01-vision-general.md` (v1.0 → v1.1), `02-requisitos.md`, `04-roadmap-fases.md` (v1.0 → v1.1)

### Changed
- **RF-015** (eventos catastróficos periódicos) vuelve a la tabla de requisitos activos, tras haber sido excluido en v0.2.0.
- Fase 4 del roadmap vuelve a incluir eventos catastróficos.
- Sección "Fuera del alcance" de la visión general actualizada: ya no incluye eventos catastróficos, solo fragmentación de hábitat y gradiente espacial.

**Motivo:** bajo costo de implementación relativo y alto valor para representar el aumento real de eventos climáticos extremos — parte central de la definición de cambio climático usada en el proyecto (tendencia + varianza).

---

## [v0.2.0] — Reducción de alcance: exclusión de mecanismos avanzados

**Documentos afectados:** `01-vision-general.md`, `02-requisitos.md`, `04-roadmap-fases.md`

### Removed
- **RF-015** (eventos catastróficos), **RF-016** (fragmentación de hábitat) y **RF-017** (gradiente espacial/migración) se excluyen del alcance del proyecto.
- Fase 4 del roadmap ("Mecanismos climáticos avanzados") se reduce a solo pool de CPU variable y mutación-estrés opcional.

**Motivo:** decisión del autor de acotar el alcance del MVP y fases iniciales a los mecanismos más directamente ligados al objetivo central del proyecto.

---

## [v0.1.0] — Documentación inicial del proyecto

**Documentos creados:** `01-vision-general.md`, `02-requisitos.md`, `03-arquitectura.md`, `04-roadmap-fases.md`, `05-estructura-repositorio.md`

### Added
- Proyecto renombrado de "proVida" a **Camevo** (Cambio + Evolución).
- Documento de visión: problema, propuesta de solución, objetivos, alcance, audiencia, criterios de éxito.
- Especificación de requisitos funcionales (RF-001 a RF-032) y no funcionales (RNF-001 a RNF-008).
- Arquitectura y stack recomendado: Node.js + TypeScript, React + Vite, PostgreSQL, Docker/Nginx sobre VPS Hetzner.
- Roadmap por fases (Fase 0 a Fase 6).
- Estructura de repositorio (monorepo), convenciones de commits y ramas.

---

## Convención de versionado de este changelog

- **MAJOR** (`v1.x.x`): se reserva para el primer despliegue real en producción
  (`camevo.ibsen-soto.pro` sirviendo tráfico real, fin de la Fase 5) — corregido en v0.10.1;
  antes decía "fin de Fase 0", que ya había quedado inconsistente con la práctica real: los
  cierres de Fase 1/2/3 se registraron como MINOR (v0.7.0, v0.8.0, v0.9.0), no como MAJOR.
- **MINOR** (`vx.N.x`): cambios de alcance — se agrega, elimina o reincorpora un requisito o
  mecanismo — y, por la excepción de abajo, también el cierre de cada fase del roadmap
  mientras no haya ocurrido el primer despliegue real.
- **PATCH** (`vx.x.N`): correcciones menores de redacción, formato o aclaraciones que no cambian el alcance.

**Excepción declarada (a partir de v0.7.0; alcance del punto de corte corregido en v0.10.1):**
los cierres de fase de implementación (v0.7.0 Fase 1, v0.8.0 Fase 2, v0.9.0 Fase 3, v0.10.0
Fase 4, y las que sigan) se registran como MINOR aunque esa fase, por sí sola, no haya
cambiado ningún documento — "Documentos afectados: ninguno" en esos casos es intencional,
no un error. Esto se mantiene así hasta el primer despliegue real en producción (fin de la
Fase 5), momento en el que corresponde el primer MAJOR (v1.0.0). Las aclaraciones de
alcance reales que una fase sí produce (si las produce) — o notas de cierre agregadas al
roadmap después del cierre en sí (p. ej. v0.9.1, v0.10.2) — se registran como entradas
PATCH separadas dentro del mismo MINOR (p. ej. v0.8.1 en la Fase 2, v0.8.2 en la Fase 3;
v0.10.1 en la Fase 4 — aunque en este caso corrigiendo esta misma convención, no un
requisito).

Cada documento individual mantiene además su propio número de versión en el encabezado (ej. "Versión 1.1"), que se incrementa cuando ese documento específico cambia.
