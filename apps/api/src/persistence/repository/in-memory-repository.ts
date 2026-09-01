import { randomUUID } from "node:crypto";
import { CreateRunInput, GenerationSnapshotRecord, RunRecord, RunRepository } from "./types";

/**
 * Implementación en memoria del mismo contrato que PostgresRunRepository.
 * Se usa en los tests de api/rest y api/ws para no depender de que haya
 * un Postgres real levantado; el contrato (RunRepository) es idéntico, así
 * que un test que pasa aquí ejercita la misma lógica de rutas/handlers
 * que se usará contra Postgres en producción.
 */
export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, RunRecord>();
  private readonly snapshots = new Map<string, GenerationSnapshotRecord[]>();

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const run: RunRecord = {
      id: randomUUID(),
      config: input.config,
      seed: input.seed,
      createdAt: new Date().toISOString(),
    };
    this.runs.set(run.id, run);
    this.snapshots.set(run.id, []);
    return run;
  }

  async getRun(id: string): Promise<RunRecord | null> {
    return this.runs.get(id) ?? null;
  }

  async saveSnapshot(runId: string, generation: number, snapshot: Record<string, unknown>): Promise<void> {
    const existing = this.snapshots.get(runId);
    if (!existing) {
      throw new Error(`No existe la corrida ${runId}`);
    }
    existing.push({ runId, generation, snapshot });
  }

  async listSnapshots(runId: string): Promise<GenerationSnapshotRecord[]> {
    const existing = this.snapshots.get(runId) ?? [];
    return [...existing].sort((a, b) => a.generation - b.generation);
  }
}
