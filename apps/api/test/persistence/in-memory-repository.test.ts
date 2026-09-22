import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryRunRepository } from "../../src/persistence/repository/in-memory-repository";
import type { CreateRunInput } from "../../src/persistence/repository/types";

const BROWSER_A = "browser-aaaaaaaa";
const BROWSER_B = "browser-bbbbbbbb";

/** Completa `id`/`browserId` con defaults razonables — la mayoría de estos tests no les importa el valor exacto. */
function input(overrides: Partial<CreateRunInput> = {}): CreateRunInput {
  return { id: randomUUID(), config: {}, seed: 1, browserId: BROWSER_A, ...overrides };
}

describe("InMemoryRunRepository (RF-030)", () => {
  it("crea una corrida y la recupera por id", async () => {
    const repo = new InMemoryRunRepository();
    const run = await repo.createRun(input({ config: { gridWidth: 10 }, seed: 42 }));

    expect(run.id).toBeTruthy();
    expect(run.seed).toBe(42);

    const fetched = await repo.getRun(run.id);
    expect(fetched).toEqual(run);
  });

  it("Grupo 1: persiste con el id EXACTO que se le pasa, no uno generado — la corrida se crea al guardar, después de que el streaming ya le mostró ese id al usuario", async () => {
    const repo = new InMemoryRunRepository();
    const fixedId = randomUUID();
    const run = await repo.createRun(input({ id: fixedId }));

    expect(run.id).toBe(fixedId);
  });

  it("getRun devuelve null si el id no existe", async () => {
    const repo = new InMemoryRunRepository();
    expect(await repo.getRun("no-existe")).toBeNull();
  });

  it("guarda y lista snapshots ordenados por generación", async () => {
    const repo = new InMemoryRunRepository();
    const run = await repo.createRun(input());

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
    async function createRunAfterTick(repo: InMemoryRunRepository, overrides: Partial<CreateRunInput> = {}) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return repo.createRun(input(overrides));
    }

    it("devuelve las corridas más recientes primero", async () => {
      const repo = new InMemoryRunRepository();
      const first = await repo.createRun(input({ seed: 1 }));
      const second = await createRunAfterTick(repo, { seed: 2 });
      const third = await createRunAfterTick(repo, { seed: 3 });

      const { runs, hasMore } = await repo.listRuns({ limit: 10, offset: 0, browserId: BROWSER_A });

      expect(runs.map((r) => r.id)).toEqual([third.id, second.id, first.id]);
      expect(hasMore).toBe(false);
    });

    it("pagina con limit/offset y reporta hasMore correctamente", async () => {
      const repo = new InMemoryRunRepository();
      await repo.createRun(input({ seed: 1 }));
      await createRunAfterTick(repo, { seed: 2 });
      await createRunAfterTick(repo, { seed: 3 });

      const page1 = await repo.listRuns({ limit: 2, offset: 0, browserId: BROWSER_A });
      expect(page1.runs.length).toBe(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await repo.listRuns({ limit: 2, offset: 2, browserId: BROWSER_A });
      expect(page2.runs.length).toBe(1);
      expect(page2.hasMore).toBe(false);
    });

    it("calcula snapshotCount y endedInExtinction a partir de los snapshots guardados", async () => {
      const repo = new InMemoryRunRepository();
      const extinctRun = await repo.createRun(input({ seed: 1 }));
      await repo.saveSnapshot(extinctRun.id, 0, { generation: 0, extinct: false });
      await repo.saveSnapshot(extinctRun.id, 1, { generation: 1, extinct: true });

      const survivingRun = await createRunAfterTick(repo, { seed: 2 });
      await repo.saveSnapshot(survivingRun.id, 0, { generation: 0, extinct: false });

      const { runs } = await repo.listRuns({ limit: 10, offset: 0, browserId: BROWSER_A });
      const extinctSummary = runs.find((r) => r.id === extinctRun.id);
      const survivingSummary = runs.find((r) => r.id === survivingRun.id);

      expect(extinctSummary?.snapshotCount).toBe(2);
      expect(extinctSummary?.endedInExtinction).toBe(true);
      expect(survivingSummary?.snapshotCount).toBe(1);
      expect(survivingSummary?.endedInExtinction).toBe(false);
    });

    it("una corrida sin snapshots tiene snapshotCount 0 y endedInExtinction false", async () => {
      const repo = new InMemoryRunRepository();
      const run = await repo.createRun(input());

      const { runs } = await repo.listRuns({ limit: 10, offset: 0, browserId: BROWSER_A });
      expect(runs[0]?.id).toBe(run.id);
      expect(runs[0]?.snapshotCount).toBe(0);
      expect(runs[0]?.endedInExtinction).toBe(false);
    });

    // Grupo 1 (Cambio 1C): esto es lo que realmente hace nuevo el
    // aislamiento por navegador — sin este filtro, RF-025 mostraba
    // corridas de cualquier persona.
    it("Grupo 1: nunca devuelve corridas de OTRO browser_id, aunque existan y sean más recientes", async () => {
      const repo = new InMemoryRunRepository();
      await repo.createRun(input({ seed: 1, browserId: BROWSER_A }));
      await createRunAfterTick(repo, { seed: 2, browserId: BROWSER_B });

      const { runs } = await repo.listRuns({ limit: 10, offset: 0, browserId: BROWSER_A });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.seed).toBe(1);
    });
  });
});
