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
}

/** Mensajes que viaja por api/ws (`/runs/:id/stream`). */
export type LiveMessage =
  | { readonly type: "snapshot"; readonly snapshot: GenerationSnapshot }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

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
