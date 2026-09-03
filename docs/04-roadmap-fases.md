# CAMEVO — Roadmap por Fases

**Versión 1.2 — Fase 0 (Documentación) — ver `CHANGELOG.md`**

El roadmap se organiza en hitos secuenciales, no en fechas fijas, dado que es un proyecto de aprendizaje construido de forma incremental. Cada fase tiene entregables verificables antes de avanzar a la siguiente.

---

### Fase 0 — Documentación y fundamentos (actual)

**Objetivo:** dejar el proyecto completamente especificado antes de escribir código de producción.

- [x] Documento de visión (`01-vision-general.md`)
- [x] Especificación de requisitos (`02-requisitos.md`)
- [x] Arquitectura y stack tecnológico (`03-arquitectura.md`)
- [ ] Estructura de repositorio y convenciones (`05-estructura-repositorio.md`)
- [ ] Renombrar repositorio/dominio de `proVida` a `Camevo`
- [ ] Configurar entorno de desarrollo local (Node, Docker, PostgreSQL)

**Entregable:** repositorio inicializado con toda la documentación base y entorno local funcional (sin lógica de negocio aún).

---

### Fase 1 — Motor de evolución digital (sin clima)

**Objetivo:** validar que la selección natural emerge genuinamente, sin ningún mecanismo climático todavía.

- Implementar la VM del organismo (registros, puntero de instrucción, memoria, set de instrucciones simplificado).
- Implementar el genoma y el mecanismo de autorreplicación.
- Implementar mutación (sustitución, inserción, eliminación) con tasa fija configurable.
- Implementar la grilla poblacional y la regla de reemplazo.
- Implementar el set inicial de tareas lógicas (empezar con NOT, AND, OR; ampliar después) y su recompensa de CPU.
- Implementar el loop de simulación básico (sin módulo climático — parámetros fijos).
- Métrica mínima de verificación: graficar fitness promedio de la población a lo largo de generaciones y confirmar tendencia ascendente sin intervención externa.

**Entregable:** motor funcional, testeado, capaz de correr una simulación fija de N generaciones desde línea de comandos o test automatizado, demostrando selección natural emergente.

**Criterio de salida de fase:** el fitness promedio de la población mejora consistentemente entre corridas repetidas con distinta semilla, sin que el código "decida" quién sobrevive.

**Estado: ✅ Cerrada.**
- RFs cubiertos: RF-001 a RF-009.
- Criterio de salida verificado empíricamente en 5 semillas (`test/simulation/fitness-trend.test.ts`): el fitness promedio del último cuarto de cada corrida supera al del primero.
- Verificado además, por separado, que el camino "mutación → resuelve tarea → recompensa de CPU" (RF-006) se activa de forma independiente del acortamiento de genoma (`test/engine/tasks-reward.test.ts`) — dos caminos evolutivos viables, no solo uno.

---

### Fase 2 — Módulo climático mínimo + visualización básica

**Objetivo:** introducir el primer mecanismo climático y hacerlo visible.

- Implementar `climate/policy` como módulo desacoplado (RF-010).
- Implementar el mecanismo de variación de recompensas por tarea a lo largo del tiempo (RF-011).
- Exponer API REST mínima para configurar una corrida (tamaño de grilla, tasa de mutación, escenario climático).
- Implementar WebSocket para emitir snapshots de generación en tiempo real.
- Construir frontend mínimo: gráfica de fitness promedio + curva del parámetro climático superpuesta (RF-020, RF-022).
- Persistir configuración y resultados básicos de cada corrida (RF-030).

**Entregable:** demo end-to-end funcional — el usuario configura una corrida, la ve evolucionar en tiempo real, y observa cómo el fitness reacciona a los cambios en las recompensas de tareas.

**Estado: ✅ Cerrada.**
- RFs cubiertos: RF-010, RF-011, RF-019 (parcial — ver nota de implementación en `02-requisitos.md`), RF-030, RF-020, RF-022, `api/rest`, `api/ws`.
- Deuda técnica dejada pendiente al cierre (resuelta como paso previo a la Fase 3): `packages/shared-types` todavía no existía como paquete real (`apps/api` y `apps/web` duplicaban tipos a mano); `apps/web` no tenía ningún test automatizado, lo que permitió que un bug de CORS y una dependencia faltante (`react-is`) solo se atraparan probando a mano en el navegador.

---

### Fase 3 — Tasa de cambio, diversidad genética y el "momento wow"

**Objetivo:** implementar el concepto central del proyecto: rescate evolutivo vs. extinción según la velocidad del cambio climático.

- Exponer control de **tasa de cambio climático** y **varianza** al usuario (RF-012, RF-013).
- Implementar cálculo de diversidad genética de la población (RF-021).
- Ajustar el frontend para mostrar claramente el desenlace de la corrida: adaptación exitosa vs. colapso poblacional.
- Implementar comparación de dos corridas en paralelo con distinta tasa de cambio (RF-025), si el tiempo lo permite; si no, documentar como siguiente hito.
- Añadir panel explicativo conectando eventos de la simulación con sus análogos reales (RF-026).

**Entregable:** el proyecto ya cumple su propósito de divulgación central — un usuario sin conocimientos técnicos puede mover el control de "velocidad de cambio climático" y ver con sus propios ojos la diferencia entre adaptación y extinción.

**Este es el hito que valida la tesis completa del proyecto.**

**Estado: ✅ Cerrada.**
- RFs cubiertos: RF-012, RF-013, RF-021, RF-025 (parcial — corridas nuevas en paralelo; sin comparar corridas históricas ya guardadas), RF-026.
- Hallazgo relevante: con los multiplicadores de `climate/policy` heredados de la Fase 2 (techo 4×-8×), el efecto de la velocidad climática resultó estadísticamente invisible — el bono de CPU por tarea resuelta era ~0.05%-0.1% del total de ciclos que la población consume replicándose, sin importar el período configurado. Corregido subiendo el techo a 16 (el nivel "muy difícil" que ya define RF-006) y sembrando un ancestro pre-adaptado (RF-008) junto al ancestro `replicate` puro de siempre.
- Aclaración importante de lo que el demo prueba: al sembrar un ancestro ya adaptado, la Fase 3 demuestra selección sobre variación genética *en pie* (standing genetic variation), no una mutación nueva apareciendo en tiempo real bajo presión climática — ver `01-vision-general.md` §9.
- Deuda técnica pendiente: RF-025 no compara corridas históricas ya guardadas; no existe mecanismo de colapso poblacional real (solo estancamiento de fitness) — eso es RF-014/RF-015 de la Fase 4.

---

### Fase 4 — Mecanismos climáticos avanzados

**Objetivo:** enriquecer el realismo del modelo con mecanismos secundarios.

- Reducción/variabilidad del pool total de CPU disponible (RF-014).
- Eventos catastróficos periódicos (RF-015).
- (Opcional) Acoplar tasa de mutación a un parámetro de estrés ambiental (RF-018).

**Entregable:** escenarios climáticos configurables y combinables, cada uno documentado con su justificación biológica.

> **Nota:** los mecanismos de gradiente espacial/migración y fragmentación de hábitat quedan explícitamente fuera del alcance del proyecto (ver `02-requisitos.md`, RF-016 y RF-017 marcados como excluidos).

---

### Fase 5 — Pulido, pruebas y despliegue

**Objetivo:** llevar el proyecto a un estado presentable y desplegado.

- Cobertura de pruebas automatizadas sobre el motor de simulación (dado que es el núcleo crítico del proyecto).
- Optimización de rendimiento si el perfilado lo justifica (evaluar en este punto si se necesita el módulo Rust/WASM mencionado en la arquitectura).
- Contenerización completa (Docker + docker-compose) y despliegue en el VPS Hetzner bajo `camevo.ibsen-soto.pro`.
- Revisión de usabilidad (RNF-004): validar con al menos una persona ajena al proyecto que entienda la simulación sin ayuda.

**Entregable:** Camevo desplegado, accesible públicamente, con documentación de portafolio lista.

---

### Fase 6 (opcional) — Capa educativa y de storytelling

**Objetivo:** maximizar el impacto divulgativo.

- Anclar la curva climática por defecto a datos reales de anomalía de temperatura histórica.
- Escenarios preconfigurados con narrativa ("¿Qué pasaría si el cambio fuera tan rápido como el observado desde 1980?").
- Modo comparación guiada (side-by-side) como experiencia principal, no solo como opción avanzada.
- Exportación de resultados (RF-032) para quien quiera analizar los datos por fuera de la plataforma.
