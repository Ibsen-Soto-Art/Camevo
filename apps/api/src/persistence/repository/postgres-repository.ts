import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { CreateRunInput, GenerationSnapshotRecord, ListRunsOptions, ListRunsResult, RunRecord, RunRepository, RunSummaryRecord } from "./types";

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

/** Crea las tablas si no existen (idempotente); se llama al arrancar la API. */
export async function ensureSchema(pool: Pool): Promise<void> {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  await pool.query(schema);
}

interface RunRow {
  id: string;
  config: Record<string, unknown>;
  seed: string | number;
  created_at: Date;
}

interface RunSummaryRow extends RunRow {
  snapshot_count: string | number;
  ended_in_extinction: boolean;
}

/** Código de error de Postgres para "invalid_text_representation" (p. ej. un UUID malformado). */
function isInvalidTextRepresentation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "22P02";
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    config: row.config,
    // pg devuelve BIGINT como string para no perder precisión; nuestras
    // semillas caben en Number.MAX_SAFE_INTEGER sin problema.
    seed: Number(row.seed),
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresRunRepository implements RunRepository {
  constructor(private readonly pool: Pool) {}

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const id = randomUUID();
    const result = await this.pool.query<RunRow>(
      "INSERT INTO runs (id, config, seed) VALUES ($1, $2, $3) RETURNING id, config, seed, created_at",
      [id, input.config, input.seed],
    );
    return toRunRecord(result.rows[0] as RunRow);
  }

  /**
   * RF-025: pide `limit + 1` filas para saber si hay más sin una consulta
   * COUNT(*) separada (ver in-memory-repository.ts para la contraparte que
   * comparten los tests). El desenlace se calcula con BOOL_OR sobre el
   * campo opaco `snapshot->>'extinct'` de cada snapshot — persistence no
   * conoce el tipo `GenerationSnapshot` del motor (ver comentario en
   * types.ts), solo agrega el JSON como texto/boolean crudo de Postgres.
   */
  async listRuns({ limit, offset }: ListRunsOptions): Promise<ListRunsResult> {
    const result = await this.pool.query<RunSummaryRow>(
      `SELECT
         r.id, r.config, r.seed, r.created_at,
         COUNT(gs.generation)::int AS snapshot_count,
         COALESCE(BOOL_OR((gs.snapshot->>'extinct')::boolean), false) AS ended_in_extinction
       FROM runs r
       LEFT JOIN generation_snapshots gs ON gs.run_id = r.id
       GROUP BY r.id
       ORDER BY r.created_at DESC, r.id ASC
       LIMIT $1 OFFSET $2`,
      [limit + 1, offset],
    );

    const hasMore = result.rows.length > limit;
    const runs: RunSummaryRecord[] = result.rows.slice(0, limit).map((row) => ({
      ...toRunRecord(row),
      snapshotCount: Number(row.snapshot_count),
      endedInExtinction: row.ended_in_extinction,
    }));

    return { runs, hasMore };
  }

  async getRun(id: string): Promise<RunRecord | null> {
    try {
      const result = await this.pool.query<RunRow>("SELECT id, config, seed, created_at FROM runs WHERE id = $1", [id]);
      const row = result.rows[0];
      return row ? toRunRecord(row) : null;
    } catch (error) {
      // Un id con formato inválido (no-UUID) no puede existir: es
      // equivalente a "no encontrado", no un error del servidor. Sin
      // esto, Postgres lanza "invalid input syntax for type uuid" y ese
      // error crudo termina filtrándose al cliente vía un 500.
      if (isInvalidTextRepresentation(error)) {
        return null;
      }
      throw error;
    }
  }

  async saveSnapshot(runId: string, generation: number, snapshot: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `INSERT INTO generation_snapshots (run_id, generation, snapshot)
       VALUES ($1, $2, $3)
       ON CONFLICT (run_id, generation) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
      [runId, generation, snapshot],
    );
  }

  async listSnapshots(runId: string): Promise<GenerationSnapshotRecord[]> {
    const result = await this.pool.query<{ run_id: string; generation: number; snapshot: Record<string, unknown> }>(
      "SELECT run_id, generation, snapshot FROM generation_snapshots WHERE run_id = $1 ORDER BY generation ASC",
      [runId],
    );
    return result.rows.map((row) => ({ runId: row.run_id, generation: row.generation, snapshot: row.snapshot }));
  }
}
