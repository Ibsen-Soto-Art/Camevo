/**
 * persistence/repository trata la configuración y los snapshots como
 * datos opacos (JSON planos), no como los tipos internos de
 * simulation/orchestrator: quien arma y valida esa forma es api/rest.
 * Esto evita acoplar la capa de persistencia a los tipos internos del
 * motor (RNF-006).
 */
export interface RunRecord {
  readonly id: string;
  readonly config: Record<string, unknown>;
  readonly seed: number;
  readonly createdAt: string;
}

export interface GenerationSnapshotRecord {
  readonly runId: string;
  readonly generation: number;
  readonly snapshot: Record<string, unknown>;
}

export interface CreateRunInput {
  readonly config: Record<string, unknown>;
  readonly seed: number;
}

/**
 * RF-025: entrada de una corrida para el selector de comparación
 * histórica — extiende `RunRecord` con lo mínimo derivado de sus
 * snapshots (sin exponer el array completo, eso es `listSnapshots`).
 * `endedInExtinction` mira si CUALQUIER snapshot persistido tiene
 * `extinct: true` (dato opaco desde este módulo, ver comentario de
 * arriba: no importa el tipo `GenerationSnapshot` del motor).
 */
export interface RunSummaryRecord extends RunRecord {
  readonly endedInExtinction: boolean;
  readonly snapshotCount: number;
}

export interface ListRunsOptions {
  readonly limit: number;
  readonly offset: number;
}

export interface ListRunsResult {
  readonly runs: RunSummaryRecord[];
  readonly hasMore: boolean;
}

/** RF-030: persistencia de configuración + snapshots por generación. */
export interface RunRepository {
  createRun(input: CreateRunInput): Promise<RunRecord>;
  getRun(id: string): Promise<RunRecord | null>;
  /** RF-025: corridas guardadas más recientes primero, para el selector de comparación histórica. */
  listRuns(options: ListRunsOptions): Promise<ListRunsResult>;
  saveSnapshot(runId: string, generation: number, snapshot: Record<string, unknown>): Promise<void>;
  listSnapshots(runId: string): Promise<GenerationSnapshotRecord[]>;
}
