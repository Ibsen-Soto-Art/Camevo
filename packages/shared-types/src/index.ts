/**
 * Contratos de datos que cruzan la frontera backend↔frontend (snapshot de
 * generación, configuración de escenario) — se definen una sola vez aquí y
 * se importan desde apps/api y apps/web (docs/05-estructura-repositorio.md
 * §3). Paquete solo de tipos: no exporta ningún valor en tiempo de
 * ejecución, así que siempre se importa con `import type`.
 */

export type PlacementMode = "near-parent" | "random";

export type ReproducibilityMode = "reproducible" | "experimental";

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
}
