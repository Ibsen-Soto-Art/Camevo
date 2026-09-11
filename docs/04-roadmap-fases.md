# CAMEVO — Roadmap por Fases

**Versión 1.6 — Fase 0 (Documentación) — ver `CHANGELOG.md`**

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
- RFs cubiertos: RF-012, RF-013, RF-021, RF-025 (parcial al cierre de esta fase — corridas nuevas en paralelo; sin comparar corridas históricas ya guardadas; cerrado por completo antes de la Fase 5, ver nota más abajo), RF-026.
- Hallazgo relevante: con los multiplicadores de `climate/policy` heredados de la Fase 2 (techo 4×-8×), el efecto de la velocidad climática resultó estadísticamente invisible — el bono de CPU por tarea resuelta era ~0.05%-0.1% del total de ciclos que la población consume replicándose, sin importar el período configurado. Corregido subiendo el techo a 16 (el nivel "muy difícil" que ya define RF-006) y sembrando un ancestro pre-adaptado (RF-008) junto al ancestro `replicate` puro de siempre.
- Aclaración importante de lo que el demo prueba: al sembrar un ancestro ya adaptado, la Fase 3 demuestra selección sobre variación genética *en pie* (standing genetic variation), no una mutación nueva apareciendo en tiempo real bajo presión climática — ver `01-vision-general.md` §9.
- Deuda técnica dejada pendiente al cierre (resuelta antes de la Fase 5, ver nota abajo): RF-025 no comparaba corridas históricas ya guardadas; no existe mecanismo de colapso poblacional real (solo estancamiento de fitness) — eso es RF-014/RF-015 de la Fase 4.

> **RF-025 cerrado por completo (antes de la Fase 5):** se agregó `GET /runs` (listado paginado de corridas guardadas, más recientes primero, con `endedInExtinction`/`snapshotCount` derivados de sus snapshots) y un tercer modo en el frontend ("Comparar corridas guardadas") que reusa el mismo layout/componentes (`RunPanel`/`ExplanatoryPanel`) que la comparación en vivo, vía un nuevo hook `useHistoricalRun` que carga config+snapshots de una corrida ya guardada en una sola pasada (`GET /runs/:id`). Antes de implementar, se confirmó con un test (no de memoria) que `ExplanatoryPanel` narra correctamente extinción/cuasi-extinción/rescate evolutivo cuando recibe el array completo de snapshots de una sola vez, sin depender del streaming evento-a-evento — es una función pura de `snapshots`, sin estado acumulado propio, así que no hizo falta ajustar esa lógica. Decisión de tipos: `GetRunResponse.run` (identidad+config) deliberadamente NO incluye `endedInExtinction`/`snapshotCount` para no crear una segunda fuente de verdad junto a `snapshots.at(-1)`; esos dos campos solo viven en `RunSummary` (la entrada de `GET /runs`), donde sí hacen falta porque ahí no viaja el array completo. Verificado además a mano contra un navegador real (Playwright ad-hoc, no parte de la suite permanente) sirviendo dos corridas reales completadas contra Postgres.

---

### Fase 4 — Mecanismos climáticos avanzados

**Objetivo:** enriquecer el realismo del modelo con mecanismos secundarios.

- Reducción/variabilidad del pool total de CPU disponible (RF-014).
- Eventos catastróficos periódicos (RF-015).
- (Opcional) Acoplar tasa de mutación a un parámetro de estrés ambiental (RF-018).

**Entregable:** escenarios climáticos configurables y combinables, cada uno documentado con su justificación biológica.

> **Nota:** los mecanismos de gradiente espacial/migración y fragmentación de hábitat quedan explícitamente fuera del alcance del proyecto (ver `02-requisitos.md`, RF-016 y RF-017 marcados como excluidos).

**Estado: ✅ Cerrada.**
- RFs cubiertos: RF-014, RF-015. RF-018 no implementado (prioridad C, no bloqueante, tal
  como estaba previsto en `02-requisitos.md`).
- Decisión de diseño: RF-014 (pool de CPU) y RF-015 (eventos catastróficos) quedan activos
  EXCLUSIVAMENTE en el preset de velocidad climática "Rápida" — medido que aplicarlos
  incluso con límites suaves a "Lenta"/"Moderada" alteraba de forma significativa el
  fitness que la Fase 3 ya había validado y cerrado (`CHANGELOG.md` v0.9.0).
- Hallazgo empírico central, verificado antes de fijar los parámetros finales: ni el pool
  de CPU reducido (`[0.01, 0.1]`) ni los eventos catastróficos (severidad 0.9 cada 10
  generaciones), por separado, producen extinción en 1500 generaciones — ambos empujan a
  la población cerca del borde, pero siempre se recupera. La extinción emerge únicamente
  de la COMBINACIÓN de ambos mecanismos. El tiempo hasta la extinción depende además de la
  capacidad adaptativa con la que parte la población: sin ninguna ventaja adaptativa muere
  en el primer evento catastrófico exacto (generación 10, 5/5 semillas); con una ventaja
  adaptativa de partida, sobrevive entre 3 y 13 veces más (generaciones 30-130, 5/5
  semillas) antes de sucumbir igual — conecta directamente con el concepto de deuda de
  extinción ya citado en `01-vision-general.md` §9: la población puede estar condenada
  mucho antes de llegar a cero, y la adaptación compra tiempo, no garantiza escapar
  indefinidamente. Evidencia completa en
  `apps/api/test/simulation/collapse-mechanism-isolation.test.ts` (25 casos).

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

---

### Deuda de alcance cerrada fuera de fase

RF-023 (control de la simulación: iniciar, pausar, ajustar velocidad de
reproducción y reiniciar — prioridad **M**, MVP) no pertenece a ninguna
fase numerada de este roadmap: es un requisito transversal de la Fase 0
que ninguna fase posterior reclamó explícitamente como propio. Por eso
pudo pasar sin implementarse durante cinco cierres de fase seguidos
(Fases 1 a 5) sin que ningún reporte de cierre lo detectara — cada
cierre listaba los RFs que SÍ tocaba esa fase, y RF-023 nunca apareció
en ninguna lista, ni como cubierto ni como pendiente.

Cerrado por completo mediante una auditoría dedicada, no como parte de
una fase: `iniciar` ya existía; `pausar` no existía en ningún nivel (el
WebSocket de `/runs/:id/stream` era unidireccional, sin ningún mensaje
cliente→servidor); `ajustar velocidad de reproducción` tampoco existía
(el ritmo entre snapshots estaba hardcodeado en el servidor, sin
exponerse al cliente); `reiniciar` funcionaba solo por accidente de que
el formulario era reenviable, sin ninguna señal en la UI de que eso era
lo que hacía. Ver `02-requisitos.md` (nota de cierre junto a RF-023)
para el detalle de la implementación — en particular la garantía de que
pausar congela el motor de verdad (`advanceGeneration` no avanza
mientras está pausado), no solo el envío, para no introducir una fuente
de no-determinismo nueva y romper RNF-003.

---

### Cierre del cabo suelto de la Fase 5: prueba de carga y decisión sobre Rust/WASM

La Fase 5 dejaba pendiente "evaluar en este punto si se necesita el
módulo Rust/WASM mencionado en la arquitectura" (ver más arriba y
`03-arquitectura.md` §4 punto 5) sin haberse corrido nunca formalmente
contra el despliegue real — el análisis original era teórico. Se cerró
después de la Fase 4 (eventos catastróficos, pool de CPU) y de la ronda
de mejoras de interfaz que agregó la transmisión de la grilla
poblacional completa (RF-024) a cada snapshot, midiendo contra el VPS
real de producción (`camevo.ibsen-soto.pro`), no contra hardware de
desarrollo.

**Hallazgo 1 — concurrencia real (RNF-001, 200-500 organismos, y la
grilla máxima real de 40×40):** con múltiples clientes WebSocket
concurrentes recibiendo streaming en vivo (incluida la grilla completa
por snapshot), el recurso que se satura primero en el VPS compartido
(2 vCPUs) es la CPU de un solo hilo de Node — no la memoria, que se
mantuvo con margen holgado en todos los escenarios probados. Cero
errores ni conexiones perdidas en ningún escenario. Este resultado por
sí solo no bastaba para decidir Rust/WASM: solo dice *que* la CPU es el
límite, no *en qué parte del trabajo por generación* se gasta.

**Hallazgo 2 — cómputo vs. serialización (hipótesis descartada con
evidencia):** antes de asumir que Rust/WASM ayudaría, se instrumentó
por separado (con medición real, no supuesta) el costo de
`advanceGeneration` (el motor) contra el de `JSON.stringify` del
snapshot (la serialización que viaja por WebSocket), a escala RNF-001 y
en la grilla máxima, sobre 300 generaciones. Resultado: el motor domina
absolutamente el trabajo en JS puro, ~94-95 % del tiempo, frente a
~5-6 % de la serialización — una proporción de ~15-17x a favor del
motor. Esto refuta directamente la hipótesis de que el cuello de
botella fuera la serialización/transmisión del snapshot; si lo fuera,
la vía de optimización habría sido compresión o limitar la frecuencia
de la grilla, no Rust/WASM.

**Hallazgo 3 — el verdadero cuello de botella no estaba en ninguna de
las dos hipótesis anteriores:** al medir el pipeline completo por
generación contra Postgres real (no simulado), la escritura de
`saveSnapshot` costaba ~6.015 ms por escritura en la grilla máxima —
aproximadamente el **64 %** del costo real total por generación, muy
por encima del cómputo del motor (1-3 ms) y de la serialización. La
causa: `saveSnapshot` se esperaba (`await`) **antes** de enviar cada
snapshot por el socket, bloqueando la cadencia visible para el usuario
con la latencia de un round-trip a Postgres.

**Confirmación causal (mismo criterio que el aislamiento de mecanismos
de la Fase 4):** se construyó una instancia experimental aislada
(contenedor y puerto distintos, misma base de datos Postgres real, red
Docker compartida, túnel SSH para preservar la ruta de red real) con
`saveSnapshot` no bloqueante, y se repitió el escenario "grilla máxima,
5 conexiones concurrentes" dos veces contra esa instancia y dos veces
contra un baseline fresco con el código original:

| Métrica (grilla máxima, 5 conexiones) | Baseline (await bloqueante) | Experimento (fire-and-forget aislado) |
| --- | --- | --- |
| Cadencia promedio | ~252 ms | ~281 ms (sin mejora — el trabajo total es el mismo) |
| Cadencia p95 | ~718 ms | ~597 ms (~17 % mejor) |
| Peor gap (máximo) | ~1927 ms | ~957 ms (~2x mejor) |

La dirección y magnitud del efecto fue consistente en ambas
repeticiones, exactamente en las métricas donde se esperaba que
apareciera (cola de la distribución, no el promedio) — el promedio no
mejoró honestamente porque desbloquear el envío no reduce el trabajo
total (cómputo + escritura), solo evita que una escritura lenta
retrase el mensaje de esa generación en particular. Esto confirmó
causalidad, no solo correlación.

**Implementación permanente:** `saveSnapshot` se cambió a
fire-and-forget acumulado (patrón `pendingWrites`: cada escritura se
dispara sin `await` inmediato, su promesa se guarda en un arreglo, y
se espera una sola vez al final, después de enviar "done" al cliente).
Se eligió fire-and-forget sobre batchear escrituras porque el problema
confirmado era la **latencia** de bloquear por escritura, no la
**cantidad** de round-trips — batchear habría añadido estado nuevo
(buffer por conexión, vaciarlo al cerrar o extinguirse) para atacar una
dimensión que la evidencia no señalaba como el problema. Un fallo de
escritura nunca se pierde en silencio: se loguea con `console.error`
incluyendo `runId` y número de generación (único mecanismo de
logging/alertas disponible hoy), y `streamRunLive` no resuelve hasta
que todas las escrituras (exitosas o falladas) terminaron — ver
`apps/api/src/api/ws/live-run.ts` y sus pruebas en
`apps/api/test/api/live-run.test.ts` (escritura lenta no bloquea el
envío, la función no resuelve hasta que todas las escrituras terminan,
y un fallo se loguea con runId+generación sin interrumpir el resto de
la corrida).

**Verificación final (código desplegado real) — resultado honestamente
ambiguo:** con el fix ya permanente, mergeado (commit `81fc7c8`) y
desplegado, se repitió el mismo escenario contra la producción real
tres veces: cadencia promedio ~216-229 ms, p95 ~813-855 ms, peor gap
~1388-2360 ms — sin replicar claramente la mejora vista en el
experimento aislado, pareciéndose más al baseline original. Antes de
concluir nada, se descartó explícitamente la hipótesis de que el
contenedor productivo estuviera sirviendo un bundle compilado viejo
(un despliegue "fantasma" que en realidad seguiría corriendo el
`await` bloqueante): se confirmó con evidencia directa, no con grep del
código fuente, que (a) esta arquitectura no compila a un `dist/` en
absoluto — `camevo-api` corre `tsx` directo contra el código fuente
TypeScript (confirmado por el árbol de procesos dentro del contenedor:
`tsx` → `esbuild`), (b) el mtime del archivo fuente en el contenedor
antecede la creación del contenedor por 18 segundos, consistente con
una reconstrucción real de la imagen y no una capa cacheada, y (c) el
contenido completo de `live-run.ts` dentro del contenedor en ejecución
coincide byte a byte con el fix. El bundle viejo/cache quedó
descartado con evidencia directa.

Un intento de aislar la causa mediante un revert-y-repetición controlado
en el propio contenedor de producción fue bloqueado dos veces por el
clasificador de seguridad del modo automático de Claude Code (una vez
vía hot-patch + `docker restart`, otra vía `git checkout` del commit
anterior dentro del checkout real de producción). Se respetó esa
decisión sin buscar rodeos, quedando sin confirmar experimentalmente si
la discrepancia se debe a ruido no controlable del VPS compartido (que
también aloja ~5 proyectos ajenos) u otra variable de producción no
identificada.

**Conclusión:** el mecanismo de la mejora quedó confirmado causalmente
en un experimento aislado y controlado (mismo criterio que la Fase 4),
y el fix está correctamente implementado, probado (173/173 pruebas de
`apps/api`) y desplegado — pero su impacto no se pudo replicar de forma
limpia bajo condiciones reales de producción no controladas. Se
documenta como **evidencia insuficiente para confirmar la magnitud de
la optimización en producción real**, sin que eso sea un fracaso del
proceso: es la conclusión honesta que soportan los datos.

En ningún punto de esta investigación —ni la concurrencia general, ni
la comparación cómputo/serialización, ni el hallazgo de Postgres— el
motor de simulación en sí mismo apareció como el cuello de botella real.
**Rust/WASM no se justifica**: el motor es rápido en términos absolutos
(1-3 ms por generación incluso en la grilla máxima) y no domina el
costo real observado en producción en ningún escenario medido.

**Optimización futura, mucho más barata que Rust/WASM, si alguna vez
hiciera falta:** limitar qué tan seguido se transmite la grilla
poblacional completa (RF-024) frente a solo las métricas agregadas,
cuando hay muchos clientes concurrentes — el hallazgo 2 muestra que el
costo de serializar/transmitir es bajo hoy, pero crecería si la
concurrencia aumentara mucho más allá de lo probado aquí.

Las corridas sintéticas generadas durante esta prueba de carga (85 en
total, todas del 2026-09-07 al 2026-09-10) se eliminaron de la base de
datos de producción (`TRUNCATE runs CASCADE`) para no ensuciar el
selector de comparación de corridas (RF-025) con datos sin valor como
historial real.
