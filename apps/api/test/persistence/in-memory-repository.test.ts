import { describe, expect, it } from "vitest";
import { InMemoryRunRepository } from "../../src/persistence/repository/in-memory-repository";

describe("InMemoryRunRepository (RF-030)", () => {
  it("crea una corrida y la recupera por id", async () => {
    const repo = new InMemoryRunRepository();
    const run = await repo.createRun({ config: { gridWidth: 10 }, seed: 42 });

    expect(run.id).toBeTruthy();
    expect(run.seed).toBe(42);

    const fetched = await repo.getRun(run.id);
    expect(fetched).toEqual(run);
  });

  it("getRun devuelve null si el id no existe", async () => {
    const repo = new InMemoryRunRepository();
    expect(await repo.getRun("no-existe")).toBeNull();
  });

  it("guarda y lista snapshots ordenados por generación", async () => {
    const repo = new InMemoryRunRepository();
    const run = await repo.createRun({ config: {}, seed: 1 });

    await repo.saveSnapshot(run.id, 2, { generation: 2 });
    await repo.saveSnapshot(run.id, 0, { generation: 0 });
    await repo.saveSnapshot(run.id, 1, { generation: 1 });

    const snapshots = await repo.listSnapshots(run.id);
    expect(snapshots.map((s) => s.generation)).toEqual([0, 1, 2]);
  });

  it("lanza al guardar un snapshot de una corrida inexistente", async () => {
    const repo = new InMemoryRunRepository();
    await expect(repo.saveSnapshot("no-existe", 0, {})).rejects.toThrow();
  });
});
