import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PostgresRunRepository, ensureSchema } from "../../src/persistence/repository/postgres-repository";

/**
 * Integración real contra Postgres. Se salta limpiamente si no hay
 * DATABASE_URL o no se puede conectar (por ejemplo, sin `docker compose up
 * camevo-db` corriendo) — ver docs/README para cómo levantarlo. La misma
 * lógica de repositorio se ejercita siempre, sin Docker, vía
 * in-memory-repository.test.ts.
 */
const databaseUrl = process.env.DATABASE_URL;
let pool: Pool | null = null;
let available = false;

if (databaseUrl) {
  const candidate = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 1000 });
  try {
    await candidate.query("SELECT 1");
    available = true;
    pool = candidate;
  } catch {
    available = false;
    await candidate.end();
  }
}

describe.skipIf(!available)("PostgresRunRepository (integración, requiere camevo-db)", () => {
  afterAll(async () => {
    await pool?.end();
  });

  it("crea el esquema, guarda una corrida y sus snapshots, y los recupera", async () => {
    const repo = new PostgresRunRepository(pool as Pool);
    await ensureSchema(pool as Pool);

    const run = await repo.createRun({ config: { gridWidth: 10, seed: 99 }, seed: 99 });
    expect(run.seed).toBe(99);

    await repo.saveSnapshot(run.id, 0, { generation: 0, averageFitness: 0.1 });
    await repo.saveSnapshot(run.id, 1, { generation: 1, averageFitness: 0.2 });

    const fetched = await repo.getRun(run.id);
    expect(fetched?.config).toEqual({ gridWidth: 10, seed: 99 });

    const snapshots = await repo.listSnapshots(run.id);
    expect(snapshots.map((s) => s.generation)).toEqual([0, 1]);
    expect(snapshots[1]?.snapshot).toEqual({ generation: 1, averageFitness: 0.2 });
  });

  it("listRuns (RF-025): ordena por más reciente, pagina y calcula endedInExtinction/snapshotCount", async () => {
    const repo = new PostgresRunRepository(pool as Pool);
    await ensureSchema(pool as Pool);

    const extinctRun = await repo.createRun({ config: { seed: 501 }, seed: 501 });
    await repo.saveSnapshot(extinctRun.id, 0, { generation: 0, extinct: false });
    await repo.saveSnapshot(extinctRun.id, 1, { generation: 1, extinct: true });

    // now() de Postgres tiene precisión de microsegundos, así que no hace
    // falta un delay artificial entre inserciones para distinguir el orden
    // (a diferencia de InMemoryRunRepository, ver in-memory-repository.test.ts).
    const survivingRun = await repo.createRun({ config: { seed: 502 }, seed: 502 });
    await repo.saveSnapshot(survivingRun.id, 0, { generation: 0, extinct: false });

    const noSnapshotsRun = await repo.createRun({ config: { seed: 503 }, seed: 503 });

    // limit=3 alcanza exactamente a las 3 corridas recién creadas, que son
    // las más recientes de la tabla sin importar filas de tests anteriores.
    const { runs } = await repo.listRuns({ limit: 3, offset: 0 });
    const byId = new Map(runs.map((r) => [r.id, r]));

    expect(runs.map((r) => r.id)).toEqual([noSnapshotsRun.id, survivingRun.id, extinctRun.id]);
    expect(byId.get(extinctRun.id)?.endedInExtinction).toBe(true);
    expect(byId.get(extinctRun.id)?.snapshotCount).toBe(2);
    expect(byId.get(survivingRun.id)?.endedInExtinction).toBe(false);
    expect(byId.get(survivingRun.id)?.snapshotCount).toBe(1);
    expect(byId.get(noSnapshotsRun.id)?.endedInExtinction).toBe(false);
    expect(byId.get(noSnapshotsRun.id)?.snapshotCount).toBe(0);

    // La tabla ya tiene filas de tests anteriores (esta suite no trunca
    // entre tests), así que con limit=1 siempre debe quedar más por leer.
    const page1 = await repo.listRuns({ limit: 1, offset: 0 });
    expect(page1.runs[0]?.id).toBe(noSnapshotsRun.id);
    expect(page1.hasMore).toBe(true);
  });

  it("getRun devuelve null (no lanza) para un id con formato inválido", async () => {
    // Regresión: encontrado por el smoke test de Playwright — un id que no
    // es un UUID válido hacía que Postgres lanzara "invalid input syntax
    // for type uuid", filtrando un error crudo de la base de datos como
    // un 500 en vez de un 404 limpio. InMemoryRunRepository nunca lo
    // atrapaba porque no valida el formato de la clave.
    const repo = new PostgresRunRepository(pool as Pool);
    await expect(repo.getRun("no-existe")).resolves.toBeNull();
  });
});

if (!available) {
  describe("PostgresRunRepository (integración)", () => {
    it.skip(`saltado: no hay Postgres disponible en DATABASE_URL (${databaseUrl ?? "no definido"}). Levanta 'docker compose up -d camevo-db' para correrlo.`, () => {});
  });
}
