/**
 * Contratos de datos que cruzan la frontera backend↔frontend (snapshot de
 * generación, configuración de escenario) — se definen una sola vez aquí y
 * se importan desde apps/api y apps/web (docs/05-estructura-repositorio.md
 * §3). Paquete solo de tipos: no exporta ningún valor en tiempo de
 * ejecución, así que siempre se importa con `import type`.
 */

export type PlacementMode = "near-parent" | "random";

export type ReproducibilityMode = "reproducible" | "experimental";

/**
 * RF-012: velocidad del cambio climático, como preset con nombre en vez
 * de pedirle a un usuario no técnico un "período en generaciones" crudo
 * (RNF-004). El servidor traduce el preset a un período real relativo a
 * `updates` de la corrida — "lenta" significa "no completa ni un ciclo
 * dentro de esta corrida", no un número de generaciones fijo; ver
 * apps/api/src/api/rest/config-request.ts para las razones exactas,
 * validadas empíricamente (docs de la Fase 3).
 */
export type ClimateChangeSpeed = "slow" | "moderate" | "fast";

/**
 * Fase 6: fuente de la tendencia climática de fondo. "synthetic" (default)
 * es la onda senoidal paramétrica de siempre; "historical" la reemplaza por
 * la serie real de anomalía de temperatura global anual de NASA GISTEMP
 * (1880-presente) — ver apps/api/src/climate/policy/gistemp-annual-anomaly.ts
 * para la fuente exacta y apps/api/src/climate/policy/historical.ts para el
 * mapeo generación→año.
 */
export type ClimateTrendSource = "synthetic" | "historical";

/** Nivel de suministro vigente de un recurso/tarea en una generación (RF-019, RF-011). */
export interface ResourceSupply {
  readonly taskId: string;
  readonly rewardMultiplier: number;
}

/** Resumen liviano de un organismo para snapshots: sin genoma (docs/03-arquitectura.md §4.1). */
export interface OrganismSummary {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly fitness: number;
}

export interface GenerationSnapshot {
  readonly generation: number;
  readonly populationSize: number;
  readonly births: number;
  /** Tasa de reemplazo generacional de la población: nacimientos / tamaño de población. */
  readonly averageFitness: number;
  readonly tasksSolvedThisUpdate: number;
  readonly climate: readonly ResourceSupply[];
  readonly organisms: readonly OrganismSummary[];
  /** RF-021: 0 = población idéntica; más cerca de 1 = más heterogénea (ver engine/population/diversity.ts). */
  readonly geneticDiversity: number;
  /** Fase 4: población = 0. Estado absorbente — una vez true, se mantiene el resto de la corrida. */
  readonly extinct: boolean;
  /**
   * Fase 4 (criterio secundario, RF-015/"deuda de extinción"): población por
   * debajo del umbral configurado durante N generaciones consecutivas ahora
   * mismo. A diferencia de `extinct`, NO es un estado absorbente: si la
   * población se recupera por encima del umbral, vuelve a `false`.
   */
  readonly nearExtinct: boolean;
  /**
   * RF-015 (marcadores visuales): true si en ESTA generación ocurrió un
   * evento catastrófico (antes del ciclo de reproducción) — un hecho ya
   * calculado por el servidor, no algo que el cliente deba re-derivar de
   * `intervalGenerations` (ese valor ni siquiera viaja al cliente hoy).
   * Permite distinguir a simple vista "el clima se puso desfavorable
   * gradualmente" (RF-011) de "hubo una catástrofe puntual" (RF-015).
   */
  readonly catastropheOccurred: boolean;
}

/** Mensajes que viaja por api/ws (`/runs/:id/stream`), servidor → cliente. */
export type LiveMessage =
  | { readonly type: "snapshot"; readonly snapshot: GenerationSnapshot }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

/**
 * RF-023: mensajes de control, cliente → servidor, sobre el mismo WS ya
 * abierto de `/runs/:id/stream`. `setSpeed` solo cambia el *ritmo* de
 * transmisión (`msPerGeneration`) — no afecta el motor ni el resultado
 * de la simulación, así que no rompe RNF-003. `pause` sí congela el
 * motor: mientras está en pausa, el servidor no llama a
 * `advanceGeneration` en absoluto (ver api/ws/playback-control.ts), no
 * solo deja de transmitir — el tiempo real que el usuario pase en pausa
 * nunca afecta el resultado final.
 */
export type ControlMessage =
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "setSpeed"; readonly msPerGeneration: number };

/** Body de `POST /runs`. Todos los campos son opcionales: el servidor aplica defaults. */
export interface CreateRunRequest {
  readonly gridWidth?: number;
  readonly gridHeight?: number;
  readonly baseCyclesPerUpdate?: number;
  readonly mutationRate?: number;
  readonly updates?: number;
  readonly placementMode?: PlacementMode;
  readonly ancestorGenomeLength?: number;
  readonly numAncestors?: number;
  readonly reproducibilityMode?: ReproducibilityMode;
  readonly climateEnabled?: boolean;
  /** RF-012. */
  readonly climateChangeSpeed?: ClimateChangeSpeed;
  /** RF-013: 0-0.5 aprox., independiente de climateChangeSpeed. */
  readonly climateVarianceAmplitude?: number;
  /** Fase 6. Default "synthetic" — ver ClimateTrendSource. */
  readonly climateTrendSource?: ClimateTrendSource;
  /**
   * RF-023: ritmo inicial de reproducción (ms entre snapshots
   * transmitidos), ajustable después en curso vía `ControlMessage`
   * ("setSpeed"). Puramente de presentación — nunca entra al fingerprint
   * de la semilla (config-request.ts) ni a `SimulationConfig`: dos
   * corridas con esto distinto y todo lo demás igual son la misma
   * corrida en modo reproducible.
   */
  readonly msPerGeneration?: number;
}

/**
 * Configuración de una corrida ya resuelta (defaults aplicados + semilla)
 * tal como se persiste y se le muestra al usuario — p. ej. para comparar
 * dos corridas (RF-025). Deliberadamente NO incluye los genomas
 * ancestrales expandidos ni el `ClimatePolicyConfig` completo: ambos son
 * reconstruibles de forma determinista a partir de estos campos (ver
 * `buildSimulationConfig` en apps/api), así que no hace falta
 * persistirlos por separado.
 */
export interface PersistedRunConfig extends Required<CreateRunRequest> {
  readonly seed: number;
}

/** Identidad + configuración de una corrida persistida — sin resultado (RF-030). */
export interface RunMetadata {
  readonly id: string;
  readonly seed: number;
  readonly createdAt: string;
  readonly config: PersistedRunConfig;
}

/**
 * RF-025: entrada de la lista de corridas guardadas — lo mínimo para
 * distinguirlas en un selector sin tener que abrir cada una. A
 * diferencia de `GetRunResponse.run`, sí incluye el desenlace
 * (`endedInExtinction`) porque aquí NO viaja el array de snapshots
 * completo del que derivarlo — sería la única fuente de verdad, no una
 * segunda.
 */
export interface RunSummary extends RunMetadata {
  readonly endedInExtinction: boolean;
  readonly snapshotCount: number;
}

/** Respuesta de `GET /runs`. */
export interface ListRunsResponse {
  readonly runs: readonly RunSummary[];
  readonly hasMore: boolean;
}

/** Respuesta de `GET /runs/:id`. `run` es solo identidad+config: el desenlace se lee de `snapshots.at(-1)`. */
export interface GetRunResponse {
  readonly run: RunMetadata;
  readonly snapshots: readonly GenerationSnapshot[];
}
