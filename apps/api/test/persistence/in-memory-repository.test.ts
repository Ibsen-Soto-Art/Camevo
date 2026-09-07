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

  describe("listRuns (RF-025)", () => {
    // Date.toISOString() en JS tiene resolución de milisegundo: sin un
    // pequeño delay entre creaciones, dos corridas seguidas pueden caer en
    // el mismo timestamp y el orden dependería del desempate por id
    // (aleatorio), haciendo el test de "más reciente primero" intermitente.
    async function createRunAfterTick(repo: InMemoryRunRepository, seed: number) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return repo.createRun({ config: { seed }, seed });
    }

    it("devuelve las corridas más recientes primero", async () => {
      const repo = new InMemoryRunRepository();
      const first = await repo.createRun({ config: { seed: 1 }, seed: 1 });
      const second = await createRunAfterTick(repo, 2);
      const third = await createRunAfterTick(repo, 3);

      const { runs, hasMore } = await repo.listRuns({ limit: 10, offset: 0 });

      expect(runs.map((r) => r.id)).toEqual([third.id, second.id, first.id]);
      expect(hasMore).toBe(false);
    });

    it("pagina con limit/offset y reporta hasMore correctamente", async () => {
      const repo = new InMemoryRunRepository();
      await repo.createRun({ config: { seed: 1 }, seed: 1 });
      await createRunAfterTick(repo, 2);
      await createRunAfterTick(repo, 3);

      const page1 = await repo.listRuns({ limit: 2, offset: 0 });
      expect(page1.runs.length).toBe(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await repo.listRuns({ limit: 2, offset: 2 });
      expect(page2.runs.length).toBe(1);
      expect(page2.hasMore).toBe(false);
    });

    it("calcula snapshotCount y endedInExtinction a partir de los snapshots guardados", async () => {
      const repo = new InMemoryRunRepository();
      const extinctRun = await repo.createRun({ config: { seed: 1 }, seed: 1 });
      await repo.saveSnapshot(extinctRun.id, 0, { generation: 0, extinct: false });
      await repo.saveSnapshot(extinctRun.id, 1, { generation: 1, extinct: true });

      const survivingRun = await createRunAfterTick(repo, 2);
      await repo.saveSnapshot(survivingRun.id, 0, { generation: 0, extinct: false });

      const { runs } = await repo.listRuns({ limit: 10, offset: 0 });
      const extinctSummary = runs.find((r) => r.id === extinctRun.id);
      const survivingSummary = runs.find((r) => r.id === survivingRun.id);

      expect(extinctSummary?.snapshotCount).toBe(2);
      expect(extinctSummary?.endedInExtinction).toBe(true);
      expect(survivingSummary?.snapshotCount).toBe(1);
      expect(survivingSummary?.endedInExtinction).toBe(false);
    });

    it("una corrida sin snapshots tiene snapshotCount 0 y endedInExtinction false", async () => {
      const repo = new InMemoryRunRepository();
      const run = await repo.createRun({ config: {}, seed: 1 });

      const { runs } = await repo.listRuns({ limit: 10, offset: 0 });
      expect(runs[0]?.id).toBe(run.id);
      expect(runs[0]?.snapshotCount).toBe(0);
      expect(runs[0]?.endedInExtinction).toBe(false);
    });
  });
});
