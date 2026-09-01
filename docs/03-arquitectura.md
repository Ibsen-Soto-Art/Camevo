# CAMEVO — Arquitectura de Software y Stack Tecnológico

**Versión 1.1 — Fase 0 (Documentación) — ver `CHANGELOG.md`**

---

## 1. Estilo arquitectónico

Camevo se diseña como un sistema de **tres capas desacopladas**, comunicadas por contratos explícitos, siguiendo el principio ya identificado como crítico en el análisis previo: *el motor de simulación no debe saber nada de cómo se visualiza, y el módulo climático no debe saber nada de cómo se ejecuta el motor* — solo emite parámetros que el motor consume.

```
┌─────────────────────┐        WebSocket (snapshots en vivo)
│   FRONTEND (Web)     │ ◄──────────────────────────────┐
│  React + TS + Vite   │                                 │
└─────────┬────────────┘                                 │
          │ REST (config, CRUD de corridas)               │
          ▼                                               │
┌─────────────────────────────────────────────────────────┴───┐
│                      BACKEND (API + Orquestador)              │
│                     Node.js + TypeScript                      │
│  ┌───────────────┐   ┌────────────────┐   ┌────────────────┐ │
│  │ Climate Engine │──▶│ Simulation Core │──▶│  Snapshot Bus  │ │
│  │ (policy)       │   │ (VM + Población)│   │ (WebSocket out)│ │
│  └───────────────┘   └────────────────┘   └────────────────┘ │
└───────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │  PostgreSQL     │
                        │ (config/runs/   │
                        │  snapshots)     │
                        └────────────────┘
```

## 2. Stack tecnológico recomendado

### 2.1 Motor de simulación y backend — **Node.js + TypeScript**

**Por qué:**
- Unifica el lenguaje entre backend y frontend (TypeScript en ambos lados), reduciendo la carga cognitiva de un proyecto individual construido de forma incremental.
- Modelo de I/O no bloqueante ideal para transmitir snapshots de simulación en tiempo real por WebSocket sin bloquear otras conexiones.
- Ecosistema npm maduro para todo lo periférico (validación, testing, WebSocket).
- Los tamaños de población objetivo del MVP (RNF-001: 200–500 organismos) son perfectamente manejables en JS/TS sin necesitar un lenguaje de sistemas.

**Nota de escalabilidad futura:** si en fases avanzadas se necesita simular poblaciones mucho más grandes o correr miles de generaciones por segundo, el "loop caliente" de la VM de organismos (RF-001/002/003) puede extraerse a un módulo en **Rust compilado a WebAssembly**, invocado desde Node mediante `napi-rs` o incluso ejecutado directamente en el navegador. Esto se documenta como opción de optimización, **no** como requisito del MVP — no lo introduzcas hasta que el perfilado de rendimiento real lo justifique.

### 2.2 Comunicación — REST + WebSocket

- **REST** (Express o Fastify sobre Node) para operaciones de configuración y CRUD: crear/listar/recuperar corridas, guardar configuración de escenario.
- **WebSocket** (librería `ws` o `socket.io`) para el flujo continuo de snapshots de simulación generación a generación hacia el frontend. Esto evita polling y permite que el usuario vea la evolución en vivo.

### 2.3 Frontend — **React + TypeScript + Vite**

**Por qué:**
- Vite da un ciclo de desarrollo rápido, importante para iterar visualizaciones.
- React + TypeScript permite tipar los mismos contratos (snapshot de simulación, configuración de escenario) que el backend, idealmente compartidos en un paquete común (ver estructura de repositorio).
- **Recharts** o **D3** para las gráficas de fitness/diversidad/curva climática (RF-020, RF-021, RF-022).
- **Canvas o SVG** para la representación de la grilla poblacional (RF-024) — Canvas es preferible si la grilla crece más allá de unas pocas decenas de celdas por rendimiento de renderizado.

### 2.4 Base de datos — **PostgreSQL**

**Por qué:**
- Relacional, adecuado para modelar corridas de simulación, configuraciones y metadatos con integridad referencial clara (RF-030/031).
- Soporte nativo de tipo `JSONB` para almacenar snapshots de generación (estructuras semi-flexibles) sin sacrificar la capacidad de consulta relacional sobre metadatos de la corrida.
- Mismo motor de base de datos que probablemente ya conoces vía Laravel/MySQL en otros proyectos, pero PostgreSQL es preferible aquí por el soporte JSONB más maduro para este caso de uso específico. (Alternativa aceptable: MySQL 8+ con columnas JSON, si prefieres mantener un único motor de BD entre todos tus proyectos — es una decisión válida de simplicidad operativa, no una obligación técnica.)

### 2.5 Infraestructura y despliegue

Alineado con tu convención ya establecida:

- **Docker + docker-compose**: contenedores separados para `api` (Node), `web` (build estático de React servido por Nginx), y `db` (PostgreSQL).
- **Nginx** como reverse proxy, igual que en tus otros proyectos.
- **VPS Hetzner**: mismo servidor donde ya despliegas tus otros proyectos.
- **Dominio**: siguiendo tu estrategia de subdominios para proyectos de portafolio, se recomienda `camevo.ibsen-soto.pro` (reemplazando el DNS que apuntaba a `provida.ibsen-soto.pro`).

### 2.6 Resumen del stack

| Capa | Tecnología | Justificación breve |
|---|---|---|
| Motor de simulación | Node.js + TypeScript | Unifica lenguaje, I/O no bloqueante, suficiente para tamaño de población del MVP |
| API | Express/Fastify (REST) + ws/socket.io (WebSocket) | Configuración vía REST, streaming en vivo vía WebSocket |
| Frontend | React + TypeScript + Vite | Tipado compartido con backend, ciclo de desarrollo rápido |
| Visualización de datos | Recharts o D3 | Gráficas de fitness/diversidad/clima |
| Visualización de grilla | Canvas (o SVG para grillas pequeñas) | Rendimiento en renderizado repetido |
| Base de datos | PostgreSQL (JSONB para snapshots) | Relacional + flexible para datos semi-estructurados |
| Contenerización | Docker + docker-compose | Consistente con tu flujo de trabajo actual |
| Reverse proxy | Nginx | Ya usado en tu infraestructura |
| Hosting | VPS Hetzner | Ya usado en tu infraestructura |
| Optimización futura (opcional) | Rust → WebAssembly | Solo si el perfilado muestra que el loop de la VM es el cuello de botella |

## 3. Desglose de módulos (backend)

- **`engine/organism`**: definición del genoma, la VM del organismo (registros, puntero de instrucción, memoria) y el set de instrucciones del lenguaje ensamblador simplificado.
- **`engine/population`**: manejo de la grilla poblacional, reemplazo de organismos y asignación de tiempo de CPU. Ahora también responsable de: (a) **sembrado inicial con múltiples organismos ancestrales** (RF-008), y (b) el **modo de colocación de la descendencia** — cerca del padre o aleatorio en la grilla (RF-009) — como estrategia intercambiable dentro del mismo módulo, no como un `if` disperso en el código.
- **`engine/tasks`**: definición de tareas lógicas evaluables (NOT, AND, OR, XOR, EQU) con su jerarquía de dificultad graduada (RF-006), y ahora el **recurso individual asociado a cada tarea**, con su propio tipo de suministro (ilimitado/limitado) (RF-019). Este módulo deja de manejar un pool de CPU único y pasa a manejar N recursos independientes, uno por tarea.
- **`climate/policy`**: el módulo climático como "política" desacoplada — recibe el número de generación y devuelve el conjunto de parámetros ambientales vigentes. Con RF-019, esto ahora significa devolver, por cada recurso/tarea, su nivel de suministro vigente (en vez de un único pool de CPU global) — es decir, el clima puede decir "el recurso de la tarea XOR se agota" sin afectar a los demás. Sigue siendo el único punto de extensión para nuevos mecanismos climáticos (eventos catastróficos, mutación ligada a estrés), sin tocar `engine/*`.
- **`simulation/orchestrator`**: el loop principal que en cada generación: consulta `climate/policy`, aplica sus parámetros a `engine/population`/`engine/tasks`, avanza la simulación, calcula métricas (fitness promedio, diversidad genética) y emite un snapshot. También es responsable de gestionar la **semilla del generador aleatorio** (RF-007): en modo *reproducible* la fija internamente a partir de la configuración guardada; en modo *experimental* la genera nueva en cada corrida. En ningún caso el número de semilla se expone al frontend como tal.
- **`api/rest`**: endpoints de configuración y persistencia de corridas, incluyendo el selector de modo *reproducible/experimental* (RF-007) al crear una corrida. Se añade un endpoint de **detalle de organismo bajo demanda** (`GET /runs/:runId/generations/:gen/organisms/:organismId`) para servir RF-027 sin sobrecargar el streaming en vivo (ver flujo de datos, punto 4.1).
- **`api/ws`**: canal de streaming de snapshots en tiempo real.
- **`persistence/repository`**: acceso a PostgreSQL (corridas, configuraciones, snapshots).

## 4. Flujo de datos (una generación)

1. El `orchestrator` solicita a `climate/policy` los parámetros vigentes para la generación N.
2. `climate/policy` calcula esos parámetros combinando tendencia + varianza según la configuración del escenario (tasa de cambio, intensidad), **por cada recurso/tarea individual** (RF-019).
3. El `orchestrator` aplica esos parámetros a `engine/population` y `engine/tasks` (nivel de suministro por recurso, tasa de mutación).
4. Cada organismo en `engine/population` ejecuta su ciclo de CPU asignado en su VM (`engine/organism`), intentando replicarse y potencialmente resolviendo tareas de `engine/tasks`; al reproducirse, se ubica según el modo de colocación configurado (RF-009).
5. El `orchestrator` calcula métricas agregadas (fitness promedio, diversidad genética) y arma un snapshot de la generación — **liviano**: incluye por organismo solo su posición, fitness y un identificador, no su genoma completo (ver 4.1).
6. El snapshot se emite por `api/ws` al frontend y opcionalmente se persiste vía `persistence/repository`.
7. El frontend recibe el snapshot y actualiza gráficas y grilla en tiempo real.

### 4.1 Flujo bajo demanda: detalle de organismo (RF-027)

Enviar el genoma completo de los cientos de organismos en **cada** snapshot de WebSocket inflaría innecesariamente el tráfico en tiempo real (impacta directamente RNF-001). En su lugar:

1. El usuario hace clic en una celda de la grilla en el frontend.
2. El frontend llama a `GET /runs/:runId/generations/:gen/organisms/:organismId` (`api/rest`).
3. `persistence/repository` (o el `orchestrator`, si la corrida está en curso y aún no se persistió esa generación) devuelve el genoma completo, las tareas resueltas y el fitness individual de ese organismo puntual.
4. El frontend renderiza el detalle sin afectar el flujo continuo de snapshots.

Esto mantiene el streaming en vivo liviano y hace que el costo de RF-027 sea proporcional a cuántas veces el usuario realmente inspecciona un organismo, no al tamaño total de la población.

## 5. Decisiones de diseño clave

| Decisión | Alternativa considerada | Por qué se eligió esta opción |
|---|---|---|
| Motor en backend (Node), no en el navegador | Simular todo en el cliente con JS puro | Evita bloquear el hilo principal del navegador y permite correr simulaciones más pesadas o de fondo sin depender del dispositivo del usuario |
| Módulo climático desacoplado como "política" | Codificar el cambio climático directamente en el loop del motor | Permite añadir nuevos mecanismos climáticos (eventos catastróficos, mutación-estrés) sin modificar ni arriesgar el motor de evolución ya validado |
| Recursos individuales por tarea (RF-019) vs. pool único de CPU | Mantener un solo pool global de CPU para toda la población | Permite que el clima afecte tareas específicas de forma independiente, más fiel al mecanismo central del proyecto (cambiar qué es adaptativo, no solo "cuánto hay") |
| Snapshot liviano + detalle de organismo bajo demanda (RF-027) | Incluir el genoma completo de cada organismo en cada snapshot de WebSocket | Evita inflar el streaming en tiempo real; el costo de servir un genoma completo solo se paga cuando el usuario realmente lo pide |
| Semilla gestionada internamente, modo reproducible/experimental (RF-007) | Exponer un campo numérico de semilla al usuario | Mejor usabilidad para público general (RNF-004) sin sacrificar reproducibilidad (RNF-003) para quien depura o compara corridas |
| Set de instrucciones simplificado vs. Avida completo | Portar el lenguaje ensamblador completo de Avida | Reduce drásticamente el esfuerzo de implementación del intérprete sin perder la propiedad esencial: que la selección natural emerja genuinamente |
| PostgreSQL con JSONB | MySQL puro / almacenamiento en archivos planos | Balance entre estructura relacional (metadatos de corridas) y flexibilidad (snapshots de generación) |
| WebSocket para streaming | Polling HTTP periódico | Menor latencia y menor carga de red para actualizaciones frecuentes (varias generaciones por segundo) |
