# CAMEVO — Especificación de Requisitos

**Versión 1.1 — Fase 0 (Documentación) — ver `CHANGELOG.md`**

Convención de identificadores: `RF-0xx` para requisitos funcionales, `RNF-0xx` para no funcionales. Prioridad: **M** (Must — MVP), **S** (Should — fase 2/3), **C** (Could — fase 4+).

---

## 1. Requisitos funcionales

### 1.1 Motor de simulación (Engine core)

| ID | Requisito | Prioridad |
|---|---|---|
| RF-001 | El sistema debe representar cada organismo como un programa con genoma (secuencia de instrucciones) ejecutado en una máquina virtual propia (registros, puntero de instrucción, memoria). | M |
| RF-002 | El sistema debe permitir que un organismo se autorreplique copiando su genoma instrucción por instrucción. | M |
| RF-003 | El sistema debe aplicar mutaciones aleatorias (sustitución, inserción, eliminación) durante la copia del genoma, con una tasa configurable. | M |
| RF-004 | El sistema debe ubicar a los organismos en una grilla poblacional (mundo); cuando la grilla está llena, un nuevo organismo debe reemplazar a un vecino según una regla definida (p. ej. el más débil). | M |
| RF-005 | El sistema debe asignar tiempo de CPU (ciclos de ejecución) a cada organismo, con una asignación base igual para todos. | M |
| RF-006 | El sistema debe reconocer cuándo un organismo resuelve una tarea lógica (NOT, AND, OR, XOR, EQU u otras definidas) y otorgar como recompensa tiempo de CPU adicional, siguiendo una jerarquía de dificultad graduada (p. ej. fácil ×2, moderada ×4, difícil ×8, muy difícil ×16), donde tareas más difíciles otorgan mayor recompensa. | M |
| RF-007 | El sistema debe permitir configurar, al iniciar una simulación, parámetros base: tamaño de la grilla, tasa de mutación inicial y set de tareas lógicas activas. Debe además ofrecer un **modo de repetibilidad** con dos opciones expuestas al usuario: *reproducible* (semilla aleatoria fija gestionada internamente, sin exponer el número crudo, útil para comparar corridas o depurar) y *experimental* (semilla verdaderamente aleatoria en cada corrida). | M |
| RF-008 | El sistema debe permitir sembrar una simulación con **múltiples organismos ancestrales distintos simultáneamente**, no solo con un único genotipo semilla, para observar competencia entre linajes desde el inicio de la corrida. | S |
| RF-009 | El sistema debe permitir configurar el **modo de colocación de la descendencia**: cerca del organismo padre (favorece estructura espacial y selección de parentesco) o en una posición aleatoria de la grilla (población bien mezclada, sin estructura espacial). | S |

> **Nota de origen:** RF-008 y RF-009 se incorporaron tras revisar la interfaz de **Avida-ED** (la versión educativa oficial de Avida), que expone ambos mecanismos como configuración estándar del entorno. Se adoptan por su bajo costo de implementación relativo y su alto valor pedagógico.

### 1.2 Módulo climático

| ID | Requisito | Prioridad |
|---|---|---|
| RF-010 | El sistema debe implementar un módulo climático desacoplado del motor de simulación, que en cada generación emite un conjunto de parámetros ambientales (recompensas por tarea, pool de CPU disponible, tasa de mutación, probabilidad de evento catastrófico). | M |
| RF-011 | El sistema debe soportar, como mecanismo climático inicial, la variación progresiva de qué tareas lógicas otorgan recompensa y en qué magnitud, a lo largo del tiempo. | M |
| RF-012 | El sistema debe permitir configurar la **tasa de cambio climático** (velocidad con la que varían los parámetros ambientales) como control expuesto al usuario. | M |
| RF-013 | El sistema debe permitir configurar la **intensidad/varianza** del cambio climático, independiente de la tendencia direccional (según el modelo combinado tendencia + varianza). | S |
| RF-014 | El sistema debe soportar reducción progresiva o errática del pool total de tiempo de CPU disponible por generación (escasez de recursos). | S |
| RF-015 | El sistema debe soportar eventos catastróficos periódicos que eliminan un porcentaje configurable de la población. | S |
| RF-018 | El sistema debe permitir vincular la tasa de mutación a un parámetro de estrés ambiental/temperatura, como mecanismo opcional no activado por defecto. | C |
| ~~RF-016~~ | ~~El sistema debe soportar fragmentación del espacio de la grilla en subregiones parcial o totalmente aisladas.~~ | **Excluido** |
| ~~RF-017~~ | ~~El sistema debe soportar un gradiente espacial que permita a los organismos "migrar" hacia zonas climáticamente más favorables.~~ | **Excluido** |
| RF-019 | El sistema debe modelar cada recurso asociado a una tarea lógica de forma individual, con **suministro configurable** (ilimitado o limitado/agotable). El módulo climático debe poder modificar el suministro de recursos específicos a lo largo del tiempo, en lugar de operar únicamente sobre un pool global de CPU. Refina y complementa a RF-006 y RF-014. | S |

> **Nota de origen:** RF-019 se incorporó tras revisar Avida-ED, donde cada recurso (Notose, Nanose, Andose...) tiene su propio tipo de suministro. Este nivel de granularidad encaja mejor con el mecanismo climático central del proyecto (RF-011: variar qué tareas dan recompensa) que un pool de CPU único e indiferenciado.

> **Nota de trazabilidad:** RF-016 y RF-017 se evaluaron y se decidió excluirlos explícitamente del alcance del proyecto (fragmentación de hábitat y gradiente espacial/migración). Se conservan sus IDs en esta tabla para dejar constancia de la decisión, no se reutilizan. RF-015 (eventos catastróficos) fue reincorporado al alcance tras revisión.

### 1.3 Visualización y control de usuario

| ID | Requisito | Prioridad |
|---|---|---|
| RF-020 | El sistema debe mostrar en tiempo real la evolución del fitness promedio de la población a lo largo de las generaciones. | M |
| RF-021 | El sistema debe mostrar en tiempo real un indicador de diversidad genética de la población (p. ej. distancia genómica promedio o diversidad de tareas resueltas). | M |
| RF-022 | El sistema debe mostrar la curva del parámetro climático principal superpuesta a las métricas de población, para relacionar visualmente causa y efecto. | M |
| RF-023 | El sistema debe permitir controlar la simulación: iniciar, pausar, ajustar velocidad de reproducción y reiniciar. | M |
| RF-024 | El sistema debe representar visualmente la grilla poblacional (estado de cada celda/organismo) de forma comprensible sin conocimientos técnicos previos. | S |
| RF-025 | El sistema debe permitir comparar dos corridas de simulación (p. ej. misma configuración con distinta tasa de cambio climático) en paralelo o superpuestas. | S |
| RF-026 | El sistema debe mostrar un panel explicativo que relacione los eventos de la simulación con sus análogos en el cambio climático real. | S |
| RF-027 | El sistema debe permitir seleccionar un organismo individual de la grilla y visualizar su genoma, las tareas lógicas que resuelve y su fitness individual. | S |

> **Nota de origen:** RF-027 se incorporó tras revisar Avida-ED, que ofrece una vista de "Organismo" independiente de la vista de "Población". Complementa las métricas agregadas (RF-020/RF-021) con evidencia concreta a nivel individual, útil para el público estudiantil (RF-026, audiencia objetivo).

### 1.4 Persistencia

| ID | Requisito | Prioridad |
|---|---|---|
| RF-030 | El sistema debe permitir guardar la configuración y los resultados (snapshots por generación) de una corrida de simulación. | M |
| RF-031 | El sistema debe permitir listar y recuperar corridas previas guardadas. | S |
| RF-032 | El sistema debe permitir exportar los resultados de una corrida (p. ej. JSON o CSV) para análisis externo. | C |

---

## 2. Requisitos no funcionales

| ID | Requisito | Prioridad |
|---|---|---|
| RNF-001 | **Rendimiento**: la simulación debe poder ejecutar poblaciones de al menos 200–500 organismos manteniendo actualizaciones fluidas en el frontend (objetivo orientativo, a validar en Fase 1). | M |
| RNF-002 | **Desacoplamiento**: el motor de simulación debe ser independiente de la capa de presentación, comunicándose mediante una interfaz bien definida (API/eventos), de modo que el motor climático pueda extenderse sin modificar el core del motor de evolución. | M |
| RNF-003 | **Reproducibilidad**: en modo *reproducible* (RF-007), dada la misma configuración, una corrida debe producir exactamente los mismos resultados generación a generación; la semilla se gestiona internamente y no se expone como número crudo al usuario final. | M |
| RNF-004 | **Usabilidad**: un usuario sin conocimientos técnicos debe poder iniciar una simulación y entender qué está observando en menos de 2 minutos. | S |
| RNF-005 | **Portabilidad/despliegue**: el sistema debe poder desplegarse mediante contenedores Docker sobre la infraestructura VPS ya utilizada (Hetzner + Nginx). | M |
| RNF-006 | **Mantenibilidad**: el código debe seguir una estructura modular documentada que permita a un desarrollador nuevo (o al propio autor, meses después) entender la arquitectura sin depender de memoria de contexto. | M |
| RNF-007 | **Observabilidad**: el sistema debe registrar logs básicos de ejecución de simulaciones (inicio, fin, errores) para depuración. | S |
| RNF-008 | **Seguridad básica**: si se expone un backend con API, debe validar entradas de configuración de simulación para evitar valores que provoquen bucles infinitos o consumo excesivo de recursos del servidor. | M |

---

## 3. Restricciones

- El proyecto es de aprendizaje individual, construido de forma incremental con apoyo de Claude Code; el cronograma se mide en fases/hitos, no en fechas fijas.
- La infraestructura de despliegue objetivo es un VPS Hetzner ya utilizado para otros proyectos del autor, con Docker y Nginx como estándar.
- No se dispone de presupuesto para servicios cloud administrados de cómputo intensivo (GPU, clústeres); la simulación debe ser viable en un VPS estándar.

## 4. Supuestos

- El usuario final accede desde navegador de escritorio o móvil moderno con soporte de WebSocket y Canvas/SVG.
- El volumen de usuarios concurrentes esperado es bajo (proyecto de portafolio/divulgación, no producto masivo) en las fases iniciales.
