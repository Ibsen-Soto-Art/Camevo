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
