# CAMEVO — Registro de Cambios (Changelog)

Este documento registra la evolución de las **decisiones de documentación y alcance** del proyecto (no del código — eso se rastrea con Git, ver `05-estructura-repositorio.md`). Sigue el estándar [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/): cada versión agrupa cambios en secciones estándar (`Added` agregado, `Changed` modificado, `Removed` excluido/retirado, `Fixed` corrección) más secciones propias del proyecto cuando el cambio lo amerita (`Motivo`, `Decisiones de diseño registradas`, `Correcciones a premisas del diagnóstico previo`, `Limitación conocida registrada`, y las que hagan falta).

Cada entrada indica qué documento(s) se vieron afectados, para poder rastrear la versión de cada archivo individual.

---

## [v0.25.0] — Tareas lógicas resueltas en el panel de hover

**Documentos afectados:** ninguno — `tasksSolvedThisUpdate` ya estaba en `GenerationSnapshot`
desde el principio; este cambio solo lo muestra.

### Added
- Panel de hover muestra "Tareas lógicas resueltas: N" por generación, inmediatamente después
  de Fitness/Población — la contradicción entre fitness alto y cero tareas resueltas debe
  verse en la misma mirada, no después de scrollear.
- Cuando N === 0: glosa "ningún organismo resolvió AND, NOT u OR en esta generación" — el cero
  habla solo pero sin contexto es ambiguo (es normal en generaciones tempranas, es el problema
  en las tardías con mutación alta).
- Sin color de alerta: pintarlo de rojo mentiría en generaciones tempranas donde el cero es
  esperado.
- Caption que define la métrica: "cantidad de veces que algún organismo resolvió correctamente
  una tarea lógica en esta generación. Puede quedar en cero mientras el fitness promedio
  sube — son dos cosas distintas". No existía ninguna descripción de esto en el gráfico: la
  única mención a tareas lógicas en toda la interfaz estaba en el panel de inspección de un
  organismo.

### Fixed
- Carrera en el handler de pong: entre leer `readyState` y enviar, el socket puede cerrarse y
  `send` lanza `InvalidStateError`. Al correr dentro del listener de "message", esa excepción
  quedaría sin atrapar y el navegador la registraría como error de consola. Cerrado con
  `try/catch`; el pong es cortesía, no protocolo crítico — un fallo silencioso es correcto.
  Contexto honesto: un fallo en UNA corrida completa de la suite (`smoke.spec.ts` y
  `fase6.spec.ts`, las dos por `expect(consoleErrors).toEqual([])`), no reproducido en cuatro
  corridas completas posteriores y sin texto de error capturado. Era la única ruta nueva capaz
  de producirlo y quedó cerrada, pero no puede afirmarse que fuera la causa.

### Anti-correlación medida que motivó el cambio
20×20, velocidad Moderada, catástrofes activas, 1500 generaciones, una semilla por fila:

| mutación | ratio fitness tardío/temprano | tareas/generación (mediana) | total de la corrida | generaciones con 0 tareas |
|---|---|---|---|---|
| 0.0 | 1.01 | 72 | 108.276 | 0% |
| 0.05 (default) | 1.98 | 60 | 90.052 | 0% |
| 0.3 | 1.24 | 0 | 264 | 91% |
| 0.7 | 1.49 | 0 | 104 | 93% |
| **1.0** | **2.03** | **0** | **229** | **87%** |

No es solo una señal engañosa: está **anti-correlacionada en los extremos**. Mutación 1.0 da el
ratio más alto de la tabla —el que mejor se lee— con el 87% de las generaciones en cero tareas;
mutación 0 da el más chato —el que peor se lee— con la mejor adaptación funcional de todas.

Varianza entre semillas con mutación 1.0 (mismas condiciones, 5 semillas):

| semilla | ratio tardío/temprano | tareas en gen 1 | tareas en gen 1499 | total de la corrida | generaciones con 0 tareas |
|---|---|---|---|---|---|
| 11 | 2.03 | 0 | 0 | 229 | 87% |
| 22 | 1.47 | 0 | 0 | 249 | 85% |
| 33 | 2.18 | 0 | 0 | 220 | 86% |
| 44 | 2.90 | 0 | 1 | 241 | 85% |
| 55 | 1.87 | 1 | 0 | 247 | 85% |

El mecanismo: con mutación 1.0 los organismos se replican y se reemplazan constantemente
(liberando celdas, lo que infla `births / populationSize`) pero casi nunca resuelven tareas.

**Corrección de unidades del diagnóstico previo:** los ~90.000 y los ~230 que se citaron son
**totales de toda la corrida**, no valores por generación, y pertenecen a **escenarios
distintos** — 90.052 es el total con mutación 0.05 y 229 el total con mutación 1.0. Por
generación, una corrida con mutación 1.0 está en 0 o 1 tarea (ver la tabla de semillas). Las
cifras "92" y "0.09" del reporte original eran esos totales divididos por mil.

### Premisas corregidas
- `tasksSolvedThisUpdate` ya llegaba al cliente sin usarse — está en `GenerationSnapshot` desde
  el commit que creó `packages/shared-types`. Sin contrato nuevo, sin cambio de motor, sin
  payload adicional, sin compatibilidad hacia atrás. Más barato que `catastropheDeaths` (v0.22.0)
  por exactamente esa razón: ahí hubo que agregar el campo al contrato y capturar en el motor un
  valor que se descartaba.

**Motivo:** con tasa de mutación alta, el gráfico de fitness mandaba la señal invertida — subía
mientras la adaptación funcional colapsaba. El panel ahora permite ver la contradicción
directamente, sin necesidad de entender la mecánica interna.

---

## [v0.24.0] — Resiliencia del WebSocket: detección de desconexión, heartbeat y memoria

**Documentos afectados:** `03-arquitectura.md` (v1.4 → v1.5 — fila nueva en tabla de
decisiones de diseño §5: heartbeat a nivel de aplicación y retención serializada de
snapshots).

### Added
- Detección de desconexión: `connectToRunStream` escucha los eventos `close` y `error` del
  socket. Si el socket se cierra sin haber recibido un mensaje `done`, emite
  `{ type: "disconnected" }` — un evento sintético del cliente que el servidor nunca envía,
  documentado como tal en shared-types. La UI muestra: "Conexión perdida — la corrida puede
  haber terminado en el servidor. Recargá la página para ver el resultado." Bandera
  `receivedDone` evita que el cierre normal (el servidor cierra el socket justo después del
  `done`) muestre el mensaje de error. Bandera `notifiedDisconnect` evita duplicarlo si
  llegan `error` y `close` seguidos.
- Heartbeat a nivel de aplicación: el servidor envía `{ type: "ping" }` cada 30 s (incluyendo
  corridas pausadas, donde no hay otro tráfico). El cliente responde con `{ type: "pong" }`
  inmediatamente y rearma un reloj de 60 s; si expira sin recibir un ping, emite
  `{ type: "disconnected" }`. El reloj arranca con el primer ping, no al conectar — sin eso,
  un cliente nuevo hablando con un servidor anterior (sin pings) declararía la conexión
  muerta a los 60 s. El heartbeat es de aplicación y no de protocolo porque el navegador
  gestiona los pings del protocolo WS de forma transparente y no los expone a JavaScript.
- `LiveMessage` gana `ping` y `disconnected`; `ControlMessage` gana `pong` — cambio de
  contrato en shared-types.

### Changed
- `LiveRunEntry.snapshots` pasa de `GenerationSnapshot[]` a `string[]`: el registro retiene
  el JSON ya serializado (calculado una vez para `socket.send()`) en vez del objeto. El
  guardado parsea al escribir a Postgres. Ganancia: 162 MB → 98 MB de heap por corrida 40×40
  (medidos con GC forzado — corrijo los 344 MB reportados durante la investigación, que
  incluían basura sin recolectar).
- `markSaved` libera el array de snapshots tras guardar con éxito: los snapshots ya están en
  Postgres, y nadie los vuelve a leer. Elimina 15 minutos de peso muerto post-guardado.

### Investigación del incidente (generación 1194)
Lo medido y descartado como causa: no existe `apps/api/src/api/ws/server.ts` (el servidor WS
se crea en `api/server.ts` sin timeouts); `proxy_read_timeout` de nginx es 3600 s (verificado
en el VPS); el motor tarda 10.2 ms de media por generación con 18.4 ms en el peor caso —
ninguno es la causa. El contenedor no sufrió OOM-kill (0 eventos, RestartCount: 0).

La causa raíz no se reprodujo. Lo confirmado: el sistema no tenía forma de detectar la
desconexión — el cliente no escuchaba `close` ni `error`, así que cualquier corte de red
dejaba la UI en "en curso" indefinidamente. Eso explica el síntoma con cualquier causa de
desconexión.

Limitación que persiste: el pico de memoria durante la corrida (98 MB para 40×40) no se
reduce con estos cambios — los snapshots deben existir en memoria entre que la corrida
termina y el usuario decide guardar. La solución estructural (persistir incrementalmente en
Postgres) queda como trabajo aparte.

---

## [v0.23.1] — Terminología: "Éxito reproductivo" en la grilla

**Documentos afectados:** ninguno — la nota de visibilidad de RF-015 en `02-requisitos.md`
lleva tres capítulos y no se le suma un cuarto por un cambio de palabras.

### Changed
- Leyenda de la grilla: "Fitness bajo/alto (pocas/muchas crías)" → "Éxito reproductivo
  bajo/alto (pocas/muchas crías)". El paréntesis explicativo se mantiene. El comentario en el
  código registra por qué dejó de decir "fitness": en la misma generación, el fitness
  instantáneo de la gráfica puede ser 1.88 mientras el éxito reproductivo acumulado del
  veterano es 136 — el mismo término para dos métricas con dos órdenes de magnitud de
  diferencia inducía a confusión.
- Panel de click-to-inspect: "Produjo N crías" → "Éxito reproductivo: N crías producidas en
  total". "En total" explicita el acumulado, que es lo que lo distingue de la tasa
  instantánea de la gráfica.

### Added
- Caption nuevo debajo de la gráfica de líneas, primero en orden de lectura (antes de los de
  diversidad genética y eventos catastróficos, que ya existían): define "Fitness promedio"
  como tasa instantánea de nacimientos por organismo en esa generación, y advierte
  explícitamente que no debe confundirse con el éxito reproductivo acumulado que muestra la
  grilla. Se lee sin descubrir que hay que pasar el mouse — ventaja sobre el tooltip flotante
  que reemplazó, que además tapaba las líneas del gráfico (v0.20.0).

### Correcciones a premisas del diagnóstico previo
- `FIXED_METRIC_DESCRIPTIONS` no existía: se creyó disponible para poner la descripción de
  "Fitness promedio". Las descripciones por métrica se eliminaron en v0.20.0 junto con
  `describeMetric` y `ChartTooltip`. La definición fue al caption, que es mejor ubicación.
- El panel de inspección no decía "Fitness: N crías" sino "Produjo N crías" — era el único
  lugar de la UI que ya evitaba el término. El cambio igualmente aplica: agrega "Éxito
  reproductivo" (compartiendo vocabulario con la leyenda) y "en total" (explicitando el
  acumulado).

### Limitación conocida registrada
El oscurecimiento sistemático de la grilla en corridas largas sigue sin resolverse: 77.5% de
celdas verdes en la generación 50 → 5.5% en la generación 1499, en una corrida sana sin
extinción. La causa es la dispersión del éxito reproductivo acumulado — el veterano con 1360
crías fija el techo de la escala, y los cientos de organismos recién nacidos (éxito = 0)
arrastran el promedio. `historicalMaxFitness` siempre coincide con el máximo entre vivos
(ratio 1.00 en 8 generaciones muestreadas), así que el denominador no está obsoleto — es la
naturaleza acumulativa de la métrica lo que abre el rango. El texto ya no miente; la escala
de color todavía se lee como un juicio de salud de la población.

---

## [v0.23.0] — Grilla sincronizada con el hover del gráfico

**Documentos afectados:** `02-requisitos.md` (v1.7 → v1.8 — una oración en la nota de
visibilidad de RF-015: los marcadores ahora son navegables y el overlay funciona en corridas
guardadas).

### Added
- La grilla poblacional muestra el snapshot de la generación que el usuario está mirando en
  el gráfico (hover), no siempre el último. Al salir del gráfico, la grilla se queda en la
  última generación vista — mismo comportamiento que el panel de valores fijo, por
  consistencia.
- Indicador de generación visible en la grilla mientras no está mostrando el último snapshot,
  separado del affordance de inspección (antes estaban atados: `inspectable=false` en
  corridas guardadas hacía invisible el indicador justo donde más importaba).

### Fixed
- El overlay ámbar de catástrofe ahora aparece en corridas ya finalizadas cuando el usuario
  hace hover sobre una generación catastrófica. Antes solo aparecía en corridas en vivo.
- En vivo, la grilla deja de animarse tras el primer hover — el snapshot hoviado congela la
  vista hasta el próximo movimiento del mouse. Es coherente con pausar (RF-023) y con el
  panel de valores fijo.

### Correcciones a premisas del diagnóstico previo
- **`onHoverGeneration` no existía:** `RunChartProps` no tenía ese callback — se creyó
  disponible. Había que agregarlo, y es el cambio estructural de este trabajo.
- **`run.snapshots` llega completo (1500+, no 300):** el LTTB vive dentro de `RunChart` por la
  decisión de v0.20.2 — la grilla recibe el array completo. No cambia la viabilidad (la
  búsqueda es O(n) sobre un array en memoria), sí el número en el comentario.
- **El overlay requirió cambio real:** sincronizar la grilla sin corregir
  `lastCatastropheGeneration` habría encendido el overlay en casi toda la corrida por una
  resta negativa al mostrar generaciones anteriores. Es el hallazgo más importante del
  diagnóstico: la mejora obvia traía un bug peor que el original.

**Motivo:** al hacer hover sobre una generación catastrófica, el panel decía "murieron 60
organismos" mientras la grilla mostraba la generación 1499 sin ninguna señal del evento. La
grilla era un espejo fijo del último snapshot, no una vista navegable de la corrida.

---

## [v0.22.0] — Panel de hover muestra organismos muertos por catástrofe

**Documentos afectados:** `02-requisitos.md` (v1.6 → v1.7 — extensión de la nota de
visibilidad de RF-015).

### Added
- `catastropheDeaths: number` en `GenerationSnapshot` (shared-types): el conteo de
  organismos eliminados por catástrofe en esa generación, o 0 si no hubo evento. El campo es
  requerido en el tipo; las corridas guardadas antes de este deploy no lo tienen en su
  JSONB — el frontend aplica `?? 0` en el punto de lectura, lo que hace que la línea
  simplemente no aparezca en esas corridas en vez de mostrar un dato inventado.
- Panel de hover: cuando `catastropheDeaths > 0`, muestra en ámbar (#f59e0b — el mismo color
  del overlay de la grilla, para que "catástrofe" tenga un solo lenguaje de color en las dos
  representaciones):
  "⚡ Catástrofe: murieron N organismos. La población se rellenó en la misma generación, así
  que la curva no baja."
  La segunda oración existe porque el número solo responde "qué pasó" pero deja intacta la
  pregunta "por qué no lo veo en la curva".

### Decisiones de diseño registradas
- Sin porcentaje: requeriría la población previa al evento, que el snapshot no tiene
  (`populationSize` se mide después del ciclo de reproducción, ya rellenada). `severity` no
  cruza la frontera cliente-servidor. El conteo absoluto es exacto; un porcentaje aproximado
  sería un dato inventado en un simulador educativo.
- Descartado: marcar celdas en la grilla por tipo de cambio. Requeriría hasta 1600 índices
  de celdas por generación catastrófica en el array caliente del snapshot — contra la
  decisión de "snapshot liviano" documentada en `03-arquitectura.md` §5. Y las celdas
  eliminadas ya están repobladas cuando se toma el snapshot, así que habría que pintar de
  otro color celdas ocupadas por organismos nuevos, lo cual es más confuso que informativo.
- Descartado: nota en el panel explicativo. No comunica la magnitud del evento ni está junto
  a la línea roja que genera la pregunta. Puede ser útil como complemento futuro, no como
  solución principal.

### Motivo
En velocidades Lenta y Moderada, la catástrofe ocurre antes del ciclo de reproducción: los
sobrevivientes rellenan las celdas vacías antes de que se tome el snapshot. La curva de
población queda plana (399-400) aunque hayan muerto 60 organismos. El único marcador visual
eran las líneas verticales rojas y el destello ámbar — sin ninguna indicación de la magnitud
del evento. Verificado en producción real: gen 60 de una corrida Moderada → 60 muertes,
populationSize 400.

---

## [v0.21.2] — CLIMATE_VARIANCE_AMPLITUDE_MAX documentada y verificada

**Documentos afectados:** ninguno — el criterio del techo queda en el código, donde se
puede verificar; `02-requisitos.md` no habla de límites numéricos de este parámetro.

### Changed
- `CLIMATE_VARIANCE_AMPLITUDE_MAX = 0.5` extraída como constante exportada en
  `config-request.ts`, junto a la validación y encima de `LIMITS` — no junto a
  `CLIMATE_MAX_MULTIPLIER` como se había pedido originalmente, porque `LIMITS` se evalúa
  antes y referenciar una `const` declarada más abajo daría `ReferenceError` por zona
  muerta temporal.
- El comentario de la constante documenta el criterio empírico con los datos medidos: a
  amplitud 0.5 el 32.9% de las generaciones quedan saturadas en los extremos del
  multiplicador, sin aumentar la variabilidad real (la media del multiplicador pasa de 8.80
  a 8.60). El comentario anterior (`RNF-008: "podrían colgar el servidor"`) no aplicaba a
  este campo — el `clamp` de `policy.ts` protege para cualquier amplitud; el 0.5 es una
  decisión de producto, no una guardia de seguridad.
- El literal en `App.tsx` queda como está pero con un comentario que cita la fuente y
  menciona el test de deriva.
- Nota nueva debajo del input de Intensidad/varianza climática con los números medidos:
  "~18% con el valor por defecto 0.15, ~33% con el máximo 0.5".

### Added
- Test de deriva entre paquetes (`climate-variance-limit.test.tsx`): lee
  `CLIMATE_VARIANCE_AMPLITUDE_MAX` de la fuente del backend con regex y compara contra el
  atributo `max` real del input renderizado (no un segundo regex sobre el JSX, que pasaría
  en verde si el número se mueve a una variable). El test incluye el comentario obligatorio
  explicando por qué cruza paquetes: `shared-types` no puede exportar valores sin un punto
  de entrada de runtime — medido y descartado: typechea en verde y rompe con
  `ERR_PACKAGE_PATH_NOT_EXPORTED` bajo `tsx` y `vite build`.

### Fixed
- `tsconfig.test.json` de `apps/web` no declaraba `"node"` en `types`, así que `node:fs` y
  `node:path` no resolvían bajo `tsc -b` (que sí incluye `test/`). El build de la imagen
  falló en el primer intento de deploy; producción no sufrió downtime porque el build falla
  antes de reemplazar imágenes. La causa de fondo: `tsc --noEmit -p apps/web` no cubre
  `test/` (resuelve solo `tsconfig.json`, que tiene `"files": []`); de ahora en más el
  chequeo de web es `npm run build`.

---

## [v0.21.1] — Correcciones de auditoría exploratoria

**Documentos afectados:** ninguno.

### Fixed
- **catastropheEnabled sin validación (introducido en v0.21.0):** enviar un valor no
  booleano (string, número, objeto) era aceptado y se persistía con el tipo incorrecto en
  el JSONB. Ahora se rechaza con 400 "catastropheEnabled debe ser booleano", al mismo nivel
  que climateEnabled — verificado contra producción real antes de esta entrada.
- **Eje "Clima" siempre visible aunque sin series:** el eje Y de clima se renderizaba
  incondicionalmente, igual que el de Población antes de v0.20.1. Ahora desaparece cuando
  las tres series climáticas están ocultas en la leyenda, y el margen derecho baja de 60 a
  30 px — el área de trazado de la pantalla inicial es visiblemente más ancha.
- **Estado de corrida en inglés:** "running", "paused" y "done" aparecían en inglés en la
  línea de estado. Ahora muestran "en curso", "pausada" y "finalizada".
- **Ocultar todas las series dejaba un estado sin salida:** con las 6 líneas ocultas, el
  panel de valores mostraba el último valor sin contexto y la leyenda perdía el foco tras
  cada toggle. Ahora el panel muestra "Activá al menos una línea en la leyenda para ver los
  valores" y el foco vuelve al ítem recién alternado — lo que resuelve también el bug de
  teclado ① (Enter → Espacio → Enter encadenan sin perder el foco ni scrollear la página),
  que se había reportado por separado.
- **Handler táctil desincronizado del margen real (no planeado):** el fix del eje de clima
  cambió el margen dinámico y dejó al handler táctil calculando el área de trazado con una
  aproximación que ya no era válida — producía saltos de generación ~300 ms después de cada
  toque. Se corrigió en el mismo commit porque el cambio lo destapó: el handler ahora lee
  el rectángulo real de la grilla cartesiana del DOM, y una ventana de 700 ms descarta los
  eventos de mouse sintéticos que el navegador emite tras el touchend.

**Motivo:** auditoría exploratoria del 2026-09-29 — búsqueda deliberada de comportamientos
que los tests existentes no detectaban. 9 anomalías encontradas; estas 5 se corrigieron en
esta entrada (ninguna crítica). Las restantes son decisiones de producto (④), limitaciones
documentadas (⑦ ⑧) o ajuste menor de prosa (⑥).

---

## [v0.21.0] — Eventos catastróficos configurables en todas las velocidades climáticas

**Documentos afectados:** `02-requisitos.md` (v1.5 → v1.6 — RF-015 amplía su alcance a las
tres velocidades, con escala proporcional documentada).

### Added
- Checkbox "Eventos catastróficos" siempre visible en el formulario (antes solo implícito
  en velocidad Rápida). Default activo con clima encendido, deshabilitado sin clima.
- `getCatastropheConfig(speed)` con escala proporcional medida empíricamente (5 semillas,
  1500 generaciones, 20×20):
  - Lenta: cada 150 generaciones, 15% eliminado — 9 eventos, ratio late/early 1.41,
    0/5 extinciones.
  - Moderada: cada 60 generaciones, 15% eliminado — 24 eventos, ratio late/early 1.53,
    0/5 extinciones.
  - Rápida: cada 10 generaciones, 90% eliminado — sin cambio respecto a v0.10.0 (cierre de
    la Fase 4, donde se fijaron esos valores); 5/5 extinciones entre generaciones 21-41.
- Verificación e2e de anclaje LTTB ahora posible: con Lenta a intervalo 150, una corrida de
  1500 generaciones produce 9 catástrofes y las 9 sobreviven al submuestreo (300 puntos ·
  9 ReferenceLine). Hasta ahora no existía, vía UI, una corrida que fuera larga Y tuviera
  catástrofes — ver la limitación declarada en v0.20.2.

### Changed
- La suba del ratio en Moderada con catástrofes (~1.53 vs ~1.02 sin ellas) es selección
  genuina por velocidad de replicación, no un artefacto: las catástrofes liberan celdas y
  los replicadores más rápidos las ocupan. Los nacimientos por generación crecen ~3.6×; la
  población promedio no varía (393.9 → 400.0 con y sin catástrofes).
- La población se rellena dentro de la misma generación en Lenta y Moderada (la catástrofe
  ocurre antes del ciclo de reproducción): el marcador visual principal es la línea
  vertical roja y el destello ámbar, no la curva de población. Nota: esto corrigió también
  la entrada v0.19.0 del CHANGELOG, donde la descripción de la caída de población era
  cierta en Rápida pero prácticamente falsa en las otras dos velocidades.
- Narrativas de "¿Puede la vida adaptarse?" y "El punto de quiebre" actualizadas para
  mencionar los eventos catastróficos con tono proporcional a su intensidad en cada
  velocidad.
- Corrección de la narrativa de "Cambio climático acelerado": describía un borde rojo
  perimetral eliminado en v0.15.1.
- La severidad de Moderada quedó en 15% y no más alta tras medirlo: a 25% el ratio sube a
  1.53 → 3.71 y a 60% a 10.4, siempre con 0/5 extinciones. Subirla no hace el escenario más
  peligroso, lo hace más selectivo — y un "punto de quiebre" cuyo gráfico de fitness se
  dispara se lee como éxito rotundo, lo contrario de lo que ese escenario enseña. Lo que
  distingue a Moderada de Lenta es la frecuencia (2.5× más eventos), no la severidad.
- `testTimeout` en `vitest.config.ts` (apps/api) subido a 20s con justificación medida: con
  catástrofes activas por defecto el motor hace bastante más trabajo por generación y el
  tiempo total de tests de apps/api pasó de 46.7s a 78.9s (~1.7×). Con eso
  `tasks-reward.test.ts` llegaba a 5.3s bajo carga y expiraba contra el límite anterior de
  5s, sin estar roto. La fragilidad era preexistente (ese test ya usaba el 64% del
  presupuesto), pero este cambio la destapó.

### Motivo
Separar "velocidad del cambio climático" de "presencia de eventos extremos" como dos
dimensiones independientes, tal como los describe el IPCC: no son lo mismo, aunque estén
relacionados. Permite comparar exactamente qué hace el cambio climático rápido solo vs.
combinado con eventos extremos.

---

## [v0.20.3] — Cursor e indicador condicionales en la grilla poblacional

**Documentos afectados:** ninguno — RF-027 mantiene el mismo alcance declarado en v0.16.0
(solo corridas en vivo); este cambio hace visible en la UI un límite que ya existía en el
servidor.

### Changed
- PopulationGrid muestra cursor de "podés clickear" e invitación ("Hacé click en una
  celda...") solo cuando la corrida está activa (running o paused). En cualquier otro
  estado (done, extinción, corrida guardada), el cursor vuelve al default y la frase se
  reemplaza por "La inspección de organismos solo está disponible durante una corrida en
  vivo."
- El click sigue funcionando en cualquier estado — quien clickee fuera de una corrida
  activa recibe el mensaje del servidor ("La corrida ya no está activa en el servidor"),
  no silencio ni un error genérico.
- El texto vive en una constante única (INSPECT_UNAVAILABLE_HINT) compartida entre la
  frase visible y el atributo title del canvas, para que no puedan divergir.

**Motivo:** la grilla invitaba a clickear aunque el servidor ya no tuviera esa corrida en
memoria — una expectativa rota que generaba el mensaje de error sin aviso previo.

---

## [v0.20.2] — Submuestreo adaptativo LTTB en el gráfico de corrida

**Documentos afectados:** `03-arquitectura.md` (v1.3 → v1.4 — nueva fila en la tabla de
decisiones de diseño, §5)

### Changed
- Las corridas largas dejan de dibujar un punto por generación: `downsampleSnapshots`
  reduce la serie a 300 puntos con LTTB (Largest Triangle Three Buckets, Steinarsson
  2013) antes de que los datos lleguen a Recharts, conservando la silueta de la curva en
  vez de tomar uno cada N (que puede caer sistemáticamente al lado de cada pico).
- Umbral de activación: solo se aplica con **más de 300 snapshots**. Una corrida de 300
  generaciones o menos se renderiza completa, sin perder un solo punto — la función
  devuelve el mismo array, sin copiarlo.
- Anclaje forzado: los snapshots con `catastropheOccurred === true` están **siempre** en
  la muestra final. No es una preferencia estética — el eje X es categórico
  (`dataKey="generation"` sin `type="number"`), así que una `<ReferenceLine>` sobre una
  generación que no quedó en los datos no se dibujaría en absoluto, y los marcadores de
  RF-015 desaparecerían del gráfico.
- El target de 300 incluye las anclas, no son 300 más las anclas: el costo de renderizado
  queda acotado. Cuando ambas garantías chocan (más generaciones catastróficas que el
  target) ganan las anclas y el total se pasa — perder un marcador de RF-015 sería un
  error de datos visible; pasarse del presupuesto solo es más lento.
- El submuestreo vive encerrado en `RunChart`, no aguas arriba en `RunPanel`/`useRun`:
  `PopulationGrid` y `ExplanatoryPanel` reciben los mismos snapshots y necesitan todos —
  la normalización de color de la grilla recorre cada organismo de cada snapshot, así que
  submuestrear antes le cambiaría la escala de color en silencio.

**Medición** (navegador real, corrida guardada de 1500 generaciones, build de producción,
mediana de 3 corridas — `test/e2e/chart-downsample-perf.spec.ts`):

| Métrica | Antes | Después |
|---|---|---|
| Puntos dibujados | 1500 | 300 |
| Trabajo de hilo principal (longtask) | 150.0 ms | **85.0 ms (−43%)** |
| Tiempo hasta que aparece la curva | 849.7 ms | 846.3 ms (sin cambio) |
| Latencia de hover (p50) | 27.3 ms | 26.2 ms (sin cambio) |

**Motivo:** reducir el trabajo de renderizado del peor caso real de la aplicación (1500
generaciones × 6 series). Queda registrado con el mismo rigor lo que el cambio **no**
hace: el tiempo hasta que el gráfico aparece no mejora, porque lo domina el payload de
`GET /runs/:id` (1500 snapshots, cada uno con su array de organismos completo), que el
submuestreo en el frontend no toca por definición. La preservación de las catástrofes
está garantizada por la función pura y verificada en tests unitarios; no hay verificación
en navegador porque hoy no existe, vía UI, una corrida que sea larga y tenga catástrofes
(se configuran solo con velocidad climática "fast", que extingue la población alrededor de
la generación 60).

---

## [v0.20.1] — Eje Y de población dinámico

**Documentos afectados:** ninguno.

### Changed
- El tercer eje Y (población, teal, derecho) aparece y desaparece junto con su serie: si
  "Población viva" está oculta en la leyenda, el eje no se renderiza, y el margen derecho
  del gráfico vuelve de 60px a 30px en vez de dejar una franja vacía donde estaba.
- `resolveChartMargin()` se extrae como función pura y exportable, usada por el mismo
  valor tanto por el `<LineChart>` como por el handler táctil: ese handler calcula el
  rectángulo de trazado a partir del margen, así que un margen dinámico calculado en dos
  lugares distintos se habría desincronizado en silencio — el gráfico se vería bien y el
  toque en mobile apuntaría a la generación equivocada.
- La `<Line>` de población ya usaba `hide` sobre el mismo `hiddenKeys` que decide el eje,
  así que línea y eje se apagan siempre juntos: Recharts nunca queda con una serie
  apuntando a un eje inexistente.

**Motivo:** corrección del cambio anterior (v0.20.0) — al volverse ocultable la serie de
población, su eje quedaba dibujado igual, ocupando espacio y mostrando una escala que no
correspondía a ninguna línea visible.

---

## [v0.20.0] — Panel de valores fijo y leyenda interactiva

**Documentos afectados:** ninguno.

### Added
- Leyenda interactiva: click (o Enter/Espacio, con `role="button"` y foco por teclado) en
  cualquier ítem muestra u oculta esa línea. Las ocultas quedan en la leyenda, atenuadas
  al 30%, en vez de desaparecer — sigue viéndose que existen y se pueden volver a activar.
- Estado inicial de la leyenda: **Fitness promedio y Población viva visibles; clima
  (AND/NOT/OR) y diversidad genética ocultos**. Son las dos métricas más intuitivas para
  alguien sin trasfondo técnico (RNF-004); las otras cuatro quedan a un click para quien
  quiera profundizar, sin saturar la vista inicial con seis líneas superpuestas.
- El panel de valores muestra solo las series actualmente visibles: ocultar una línea en
  la leyenda también la saca del panel.

### Changed
- El panel de valores persiste después de que el mouse sale del gráfico: ya no hay
  `onMouseLeave` que limpie el estado, así que se puede hacer scroll para leerlo sin que
  se borre. El tooltip flotante original desaparecía apenas el mouse salía del `<svg>`,
  lo que lo volvía ilegible justo cuando hacía falta desplazarse para verlo.
- Handler táctil explícito para mobile, agregado tras verificarlo con emulación táctil
  real en Playwright (no por suposición): se midió que toques independientes sucesivos no
  actualizaban de forma confiable la generación activa de Recharts más allá del primero,
  mientras que los movimientos de mouse sí. El handler traduce la posición del toque a la
  generación más cercana por su cuenta.

### Removed
- El tooltip flotante de Recharts con las descripciones pedagógicas completas por línea
  —declarado como `Added` en v0.19.0 ("Tooltip pedagógico: descripción en lenguaje llano
  conectando RF-015 con RF-011")— se retira y queda reemplazado por el panel fijo. El
  tooltip tapaba con su propio cuadro justo las líneas que el usuario estaba tratando de
  leer, que era el problema original. El contenido pedagógico no se pierde: la distinción
  entre caída abrupta (RF-015) y caída gradual por clima (RF-011) vive ahora en las notas
  de texto permanentes debajo del gráfico, visibles sin necesidad de pasar el mouse.
- Con el tooltip se retiran también las funciones que solo existían para alimentarlo
  (`ChartTooltip`, `buildHoverPayload`, `describeMetric`) y sus tests, en vez de dejarlas
  como código muerto.

**Motivo:** con seis series simultáneas el gráfico era visualmente denso y el tooltip
flotante competía por el mismo espacio que los datos. Las dos mejoras atacan el mismo
problema desde lados opuestos: menos líneas dibujadas por defecto, y los valores en un
lugar fijo que no tapa nada.

---

## [v0.19.1] — Nota pedagógica de "último organismo vivo"

**Documentos afectados:** ninguno.

### Changed
- ExplanatoryPanel muestra una nota de advertencia específica cuando
  populationSize === 1 y la corrida sigue en curso: explica que el
  organismo sigue replicándose pero cada cría es eliminada antes de
  establecerse, y que la extinción es inminente no por envejecimiento
  sino porque el entorno cambia más rápido de lo que una sola línea
  puede reconstituir una población viable.
- La nota toma prioridad sobre el mensaje de nearExtinct (poblaciones
  por debajo del 10%) cuando la población llega exactamente a 1,
  sin solaparse con el mensaje de extinción real (que aparece cuando
  status === "done" con extinct === true).

**Motivo:** responder en la propia UI la pregunta natural de cualquier
visitante que vea una corrida con un solo organismo sobreviviendo
durante muchas generaciones — sin cambiar el motor de simulación
(la muerte por envejecimiento no es parte del modelo, por razones
biológicas documentadas).

---

## [v0.19.0] — Línea de "Población viva" en el gráfico de corrida

**Documentos afectados:** ninguno — populationSize ya existía en
GenerationSnapshot desde la Fase 2; este cambio solo lo visualiza.

### Added
- Tercer eje Y en RunChart (derecho, teal #2dd4bf) mostrando el número
  de organismos vivos generación a generación — "Población viva" en la
  leyenda.
- El efecto de los eventos catastróficos (RF-015) queda más visible en la
  curva de población. **Corrección posterior, tras medirlo:** la
  caída de población es claramente visible en velocidad Rápida; en Lenta y
  Moderada la población se rellena casi inmediatamente dentro de la misma
  generación, por lo que el marcador visual principal de las catástrofes es
  la línea vertical roja en la gráfica y el destello ámbar en la grilla, no
  la curva de población. La afirmación original de esta entrada ("la caída
  abrupta de la curva de población inmediatamente después de cada evento")
  era cierta para la única velocidad que tenía catástrofes en ese momento
  —Rápida— y dejó de serlo al extenderse RF-015 a las tres.
- Tooltip pedagógico: descripción en lenguaje llano conectando RF-015
  (caída abrupta) con RF-011 (caída gradual por clima), para que el
  usuario distinga los dos mecanismos.

**Motivo:** cerrar el gap entre lo que el motor ya calculaba
(populationSize en cada snapshot) y lo que el usuario podía ver — la
evolución de la población en el tiempo era invisible en la gráfica,
aunque ya existía en los datos.

---

## [v0.18.0] — Rediseño visual completo

**Documentos afectados:** ninguno de los docs de requisitos/arquitectura — es una decisión
de producto con identidad visual definida y aprobada, no un cambio de alcance funcional.

### Changed
- Dirección visual completa aprobada e implementada de una sola vez ("vitrina en la
  oscuridad"): paleta oscura (`#0b1512` fondo, `#13201c` paneles, `#2dd4bf` acento teal,
  `#a78bfa` acento violeta), tipografía Fraunces (títulos) + IBM Plex Sans (cuerpo/UI), y
  layout de dos columnas 30/70 en desktop (controles/contenido), apiladas por debajo de
  900px.
- Elemento visual distintivo: textura de grilla estática a ~7% de opacidad como fondo de
  toda la página, con el mismo gris que "hábitat vacío" en la grilla poblacional — evoca
  "vida en una grilla" sin animar nada ni competir visualmente con la grilla real. Se
  descartó una alternativa con partículas animadas por ese mismo motivo, además de su
  costo de rendimiento en mobile y en el VPS.
- El gráfico de líneas se retematiza para el fondo oscuro (grid, ejes, cursor) sin tocar
  los colores que identifican cada serie de datos (fitness, diversidad genética, clima).
- El botón "Guardar esta corrida" se reubica al cierre de la narrativa de cada corrida
  (después del panel explicativo), en vez de antes del gráfico.

**Motivo:** decisión de identidad visual de producto — propuesta en texto (paleta,
tipografía, jerarquía, layout) y aprobada explícitamente antes de implementar una sola
línea de CSS, para que Camevo tuviera personalidad propia en vez de verse como una demo
técnica sin diseño. Verificado con Playwright en los tres anchos de viewport aprobados
(375/768/1280px) y los tres modos (corrida única, comparación en vivo, comparación de
corridas guardadas) contra la API y Postgres reales.

---

## [v0.17.0] — Privacidad y guardado intencional

**Documentos afectados:** `02-requisitos.md` (v1.4 → v1.5 — nota de actualización junto a
RF-030/RF-031) y `03-arquitectura.md` (v1.2 → v1.3 — nueva sección 4.2, identidad por
navegador y guardado intencional, más una fila nueva en la tabla de decisiones de diseño)

### Added
- Identidad anónima por navegador: un UUID v4 generado una sola vez en el frontend y
  guardado en `localStorage`, enviado en cada request como header `X-Browser-ID` — sin
  login, sin cuentas, sin email. Si se borra el localStorage/las cookies, el acceso a las
  corridas guardadas con ese id desaparece con él: comportamiento esperado, no un bug.
- Guardado intencional (Cambio 1B): una corrida deja de persistirse automáticamente en
  Postgres al completarse — mientras transmite en vivo, solo se acumula en
  `LiveRunRegistry` (memoria). Recién se persiste si el usuario hace click en "Guardar
  esta corrida", vía el nuevo endpoint `POST /runs/:id/save`.
- Aislamiento por navegador: `GET /runs` filtra por `browser_id`, y `GET /runs/:id`
  devuelve 403 (no 404) si la corrida existe pero pertenece a otro navegador.
- Columna `browser_id TEXT NOT NULL` con índice en la tabla `runs` de producción —
  agregada de forma segura porque la tabla se vació explícitamente antes de la migración.
- Nota visible en el selector de corridas guardadas (RF-025) explicando que son propias de
  ese navegador/perfil, y que se pierden al borrar caché o usar modo incógnito.

**Motivo:** llevar la privacidad a un diseño explícito antes del rediseño visual, tal como
pidió el autor — sin sistema de cuentas, aislamiento casual entre navegadores (no
autenticación real), y sin que cada corrida experimental quede persistida en la base antes
de que el usuario decida que vale la pena guardarla.

---

## [v0.16.0] — RF-027 completo: click-to-inspect en grilla poblacional

**Documentos afectados:** `02-requisitos.md` (v1.3 → v1.4 — nota de cierre junto a RF-027) y
`03-arquitectura.md` (v1.1 → v1.2 — nota de reducción de alcance en §4.1, URL corregida de
`:generation` a sin ese parámetro; ya hecho en el mismo commit de implementación, `3593ff8`,
sin changelog propio hasta ahora)

### Changed
- RF-027 completado: click en una celda ocupada de la grilla poblacional abre un panel con
  el detalle del organismo (crías producidas, tareas lógicas resueltas, generación,
  posición), en lenguaje llano — vía el nuevo endpoint `GET
  /runs/:runId/organisms/:organismId`.
- `LiveRunRegistry` (`api/live-run-registry.ts`): nuevo estado en memoria compartido entre
  `api/ws` (dueño del `SimulationState` mientras la corrida transmite) y `api/rest` (que lo
  lee bajo demanda), inyectado una sola vez desde `api/server.ts` para no crear una
  dependencia circular entre ambos módulos.
- Alcance reducido respecto al diseño original documentado: solo sirve la generación
  ACTUAL de una corrida que sigue en vivo en el mismo proceso — nunca generaciones pasadas
  ni corridas ya guardadas, porque el genoma y las tareas resueltas de un organismo nunca
  se persisten (solo `{id,x,y,fitness}` llega a la base). La URL ya no lleva
  `:generation` como sugería el diseño original, para no prometer algo que el servidor no
  puede cumplir.
- Dos casos de 404 distintos, cada uno con su propio mensaje en español: la corrida entera
  puede no estar activa (terminada, o el servidor se reinició), o la corrida sigue activa
  pero ese organismo puntual ya no existe (murió o fue reemplazado).

**Motivo:** RF-027 ("vista de organismo individual") estaba declarado en requisitos desde
v0.4.0 pero nunca se había implementado — se completa acá, con el alcance real ajustado a
lo que el modelo de datos existente puede sostener.

---

## [v0.15.1] — Ajustes de UX, visibilidad y onboarding (correcciones post-verificación de RNF-004)

**Documentos afectados:** ninguno.

### Changed
- Tooltip de la gráfica movido a un panel externo fijo debajo del gráfico — ya no tapa las
  líneas al pasar el mouse.
- Evento catastrófico marcado con un overlay ámbar (`#f59e0b`) semi-transparente sobre toda
  la grilla, en vez de un borde rojo perimetral — diferenciado a propósito del rojo que ya
  usa la escala de fitness bajo.
- Espaciado vertical del gráfico corregido: la etiqueta "Generación" se movió fuera del
  `<svg>` (texto HTML plano con margen normal), porque competía con la leyenda por un
  presupuesto de espacio interno fijo de Recharts.
- Hero section nuevo: tres líneas cortas en lenguaje llano (qué es / para qué sirve / cómo
  empezar), pensadas para caber sin scroll en mobile, antes de cualquier control técnico.
- La narrativa de cada escenario preconfigurado ahora avisa explícitamente, antes de
  iniciar la corrida, qué eventos catastróficos vas a ver y dónde buscarlos.
- Definición mínima de "fitness" agregada directamente en la leyenda de la grilla
  poblacional ("pocas crías" / "muchas crías"), donde el usuario ya está mirando el color.
- El formulario de configuración queda colapsado por defecto apenas se elige un escenario
  preconfigurado, en vez de quedar siempre abierto.

**Motivo:** la verificación de RNF-004 con una persona real fuera del equipo (mencionada en
el cierre de la Fase 6, v0.15.0) encontró fricciones concretas de interfaz — corregidas acá
en dos rondas sucesivas de ajuste, antes de continuar con cualquier otro trabajo.

---

## [v0.15.0] — Cierre de Fase 6: capa educativa

**Documentos afectados:** `04-roadmap-fases.md` (v1.6 → v1.7 — nota de cierre de Fase 6)

### Added
- Tres escenarios preconfigurados con narrativa en lenguaje de divulgación ("¿Puede la vida
  adaptarse?", "Cambio climático acelerado", "El punto de quiebre"), cada uno autocompletando
  velocidad climática y modo de repetibilidad sobre el mismo formulario ya validado en fases
  anteriores.
- Opción de curva climática basada en datos reales de temperatura global histórica (NASA
  GISTEMP, 1880-2025) como alternativa a la curva sintética paramétrica.
- Cita verificada del IPCC AR6 Grupo de Trabajo II (2022) en el panel de extinción: riesgo
  MUY ALTO de extinción — 3-14% de las especies evaluadas a 1.5°C de calentamiento, 3-18% a
  2°C — verificada contra el PDF de la fuente primaria, no citada de memoria.

### Changed
- Verificación de RNF-004 (una persona sin conocimientos previos entiende el propósito del
  simulador en los primeros minutos) con una persona real fuera del equipo: el núcleo se
  cumplió, con tres fricciones de interfaz identificadas — corregidas en la entrada
  siguiente (v0.15.1).

**Motivo:** cierre de la Fase 6 del roadmap — una capa de divulgación/educación agregada
sobre un motor y un módulo climático ya estables y cerrados en fases anteriores, pensada
para que el proyecto comunique su propósito a alguien sin trasfondo técnico, no solo a
quien ya entiende qué es un algoritmo evolutivo.

---

## [v0.14.0] — Cierre del cabo suelto de la Fase 5: prueba de carga real y decisión sobre Rust/WASM

**Documentos afectados:** `04-roadmap-fases.md` (v1.5 → v1.6 — nueva sección "Cierre del
cabo suelto de la Fase 5")

### Changed
- Se corrió, por primera vez de forma real (nunca se había hecho formalmente, solo
  analizado en teoría), la prueba de carga contra el VPS de producción que la Fase 5 dejaba
  pendiente para decidir si el motor necesita Rust/WASM. Con la evidencia medida: el motor
  de simulación domina el trabajo en JS puro (~94-95 %, frente a ~5-6 % de la
  serialización JSON, ~15-17x), pero el costo real dominante del pipeline por generación
  resultó ser la escritura a Postgres (~64 %, por un `await` bloqueante antes del envío por
  WebSocket) — algo que ninguna de las dos hipótesis originales (cómputo vs. serialización)
  cubría.
- Confirmada la causalidad (mismo criterio de aislamiento que la Fase 4) con un experimento
  controlado: desbloquear `saveSnapshot` del camino crítico (patrón fire-and-forget con
  `pendingWrites`) mejoró la cola de la distribución (p95 ~17 %, peor caso ~2x) sin cambiar
  el promedio, consistente en dos repeticiones. El fix se implementó de forma permanente en
  `apps/api/src/api/ws/live-run.ts`, con logging garantizado de cualquier fallo de escritura
  (nunca se pierde un snapshot en silencio) y cobertura de pruebas dedicada.
- La réplica final contra el código ya desplegado en producción no reprodujo con claridad la
  mejora vista en el experimento aislado; se descartó explícitamente, con evidencia directa
  (no solo grep del código), que esto se debiera a un bundle compilado viejo. Se documenta
  honestamente como evidencia insuficiente para confirmar la magnitud de la optimización en
  producción real no controlada, sin que eso invalide la causalidad ya confirmada en el
  experimento aislado.
- **Decisión de alcance:** Rust/WASM no se justifica — en ningún escenario medido el motor
  fue el cuello de botella real. Queda anotada como optimización futura mucho más barata,
  si alguna vez hiciera falta, limitar la frecuencia de transmisión de la grilla poblacional
  completa (RF-024) frente a solo métricas agregadas bajo alta concurrencia.

**Motivo:** cerrar con evidencia real (no "parece que anda bien") el único cabo suelto que
quedaba abierto de la Fase 5, ahora que el sistema incluye la Fase 4 (eventos catastróficos)
y la grilla poblacional en vivo (RF-024) de la ronda de mejoras de interfaz — ambos cambios
posteriores al análisis teórico original que motivó dejar esta prueba pendiente.

---

## [v0.13.0] — RF-024 completo: grilla poblacional, con visibilidad nueva para RF-008/RF-015

**Documentos afectados:** `02-requisitos.md` (v1.2 → v1.3 — nota de cierre junto a RF-024,
notas de visibilidad junto a RF-008 y RF-015) y `03-arquitectura.md` (v1.1 → v1.2 — nota de
confirmación en la sección 4, punto 5)

### Changed
- RF-024 completado: grilla poblacional estilo Avida-ED (`PopulationGrid`, canvas) — cada
  celda ocupada coloreada por fitness normalizado contra el máximo histórico de esa corrida
  (no el de cada snapshot individual, para no mostrar "saludable" a una población rumbo al
  colapso), celdas vacías con color distinto (hábitat perdido).
- RF-008 y RF-015 no cambiaron de estado (ya estaban completos a nivel de motor desde las
  Fases 1 y 4 respectivamente), pero ganaron visibilidad explícita en la UI que antes no
  tenían: RF-008 ahora declara el conteo real de linajes sembrados (antes la única nota
  existente no reflejaba el número real y desaparecía justo en extinción/cuasi-extinción);
  RF-015 ahora tiene marcadores visuales — una línea de referencia en la gráfica y un
  destello de borde de un solo cuadro en la grilla — para distinguirlo de un clima que
  simplemente se puso desfavorable de forma gradual (RF-011), antes indistinguibles a
  simple vista.
- `GenerationSnapshot` gana `catastropheOccurred` (shared-types) para soportar los
  marcadores de RF-015 — un hecho ya calculado por el servidor, no algo que el frontend
  deba re-derivar.

**Motivo:** cierre de la ronda de mejoras de interfaz iniciada tras RF-023 (v0.12.0). El
recorte de etiquetas de ejes y el rediseño responsive, hechos en la misma ronda, no
generan entradas propias acá: son cambios de código sin ninguna decisión de alcance o
documentación detrás (ver la nota introductoria de este documento) — quedan registrados en
git (commits `6212551` y `14d6925`), no en el changelog.

---

## [v0.12.0] — RF-023 completo: pausar, ritmo de reproducción y reiniciar

**Documentos afectados:** `02-requisitos.md` (v1.1 → v1.2 — nota de cierre junto a RF-023) y
`04-roadmap-fases.md` (v1.4 → v1.5 — nueva sección "Deuda de alcance cerrada fuera de fase")

### Changed
- RF-023 completado: pausar (con congelamiento real del motor — `advanceGeneration` no
  avanza mientras está pausado, para no introducir una fuente de no-determinismo nueva y
  romper RNF-003), `msPerGeneration` configurable al iniciar y ajustable en vivo sobre el
  mismo WebSocket ya abierto (`ControlMessage`, protocolo cliente→servidor nuevo), y un
  botón de reinicio explícito (antes solo funcionaba por accidente de que el formulario
  era reenviable, sin ninguna señal de que eso era lo que hacía).

**Motivo:** una auditoría de código (no de memoria) detectó que RF-023, prioridad **M**
(MVP) desde la Fase 0, nunca se declaró completo ni parcial en ningún cierre de fase —
Fases 1 a 5 lo pasaron por alto porque es un requisito transversal que ninguna fase
numerada reclamó como propio. Se cierra fuera de cualquier fase, antes de continuar con la
siguiente serie de mejoras de interfaz (etiquetas de ejes, grilla poblacional estilo
Avida-ED, marcadores de eventos catastróficos, visibilidad de ancestros múltiples,
rediseño responsive).

---

## [v0.11.0] — RF-025 completo: comparación de corridas guardadas

**Documentos afectados:** `04-roadmap-fases.md` (v1.3 → v1.4 — nota de cierre de Fase 3
actualizada: RF-025 ya no figura como parcial)

### Changed
- RF-025 completado: además de comparar corridas nuevas en paralelo (Fase 3), ahora se
  pueden comparar dos corridas ya guardadas del historial, lado a lado, reutilizando el
  mismo RunPanel/ExplanatoryPanel sin modificarlos (vía un tipo RunView compartido entre
  useRun y el nuevo useHistoricalRun).
- Nuevo endpoint GET /runs (listado paginado) y tipos RunMetadata/RunSummary/
  GetRunResponse en shared-types — GetRunResponse.run deliberadamente sin
  endedInExtinction/snapshotCount para no crear una segunda fuente de verdad junto a
  snapshots.at(-1).extinct.

**Motivo:** cerrar la deuda que RF-025 arrastraba desde el cierre de la Fase 3 (v0.9.0),
antes de empezar la Fase 5.

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
