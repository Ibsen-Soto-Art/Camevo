# CAMEVO — Registro de Cambios (Changelog)

Este documento registra la evolución de las **decisiones de documentación y alcance** del proyecto (no del código — eso se rastrea con Git, ver `05-estructura-repositorio.md`). Sigue el estándar [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/): cada versión agrupa cambios en `Added` (agregado), `Changed` (modificado) y `Removed` (excluido/retirado).

Cada entrada indica qué documento(s) se vieron afectados, para poder rastrear la versión de cada archivo individual.

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

- **MAJOR** (`v1.x.x`): se reserva para cuando el proyecto pase de fase de documentación a desarrollo activo (fin de Fase 0).
- **MINOR** (`vx.N.x`): cambios de alcance — se agrega, elimina o reincorpora un requisito o mecanismo.
- **PATCH** (`vx.x.N`): correcciones menores de redacción, formato o aclaraciones que no cambian el alcance (se usará a partir de que ocurra el primer caso).

Cada documento individual mantiene además su propio número de versión en el encabezado (ej. "Versión 1.1"), que se incrementa cuando ese documento específico cambia.
