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

/** RF-030: persistencia de configuración + snapshots por generación. */
export interface RunRepository {
  createRun(input: CreateRunInput): Promise<RunRecord>;
  getRun(id: string): Promise<RunRecord | null>;
  saveSnapshot(runId: string, generation: number, snapshot: Record<string, unknown>): Promise<void>;
  listSnapshots(runId: string): Promise<GenerationSnapshotRecord[]>;
}
