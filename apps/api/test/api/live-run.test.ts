import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { streamRunLive } from "../../src/api/ws/live-run";
import { PlaybackControl } from "../../src/api/ws/playback-control";
import { InMemoryRunRepository } from "../../src/persistence/repository/in-memory-repository";
import { GenerationSnapshotRecord } from "../../src/persistence/repository/types";
import { SimulationConfig } from "../../src/simulation/orchestrator/run";
import type { LiveMessage } from "@camevo/shared-types";

/** WebSocket falso mínimo: solo lo que streamRunLive realmente usa. */
class FakeSocket extends EventEmitter {
  static readonly OPEN = 1;
  readonly OPEN = FakeSocket.OPEN;
  readyState = FakeSocket.OPEN;
  readonly sent: LiveMessage[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as LiveMessage);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
  }
}

describe("streamRunLive — corte temprano por extinción (Fase 4)", () => {
  it("termina antes de config.updates cuando la población se extingue, y cierra el socket con 'done'", async () => {
    const config: SimulationConfig = {
      gridWidth: 5,
      gridHeight: 5,
      baseCyclesPerUpdate: 20,
      mutationRate: 0.05,
      ancestorGenomes: [createUniformGenome("replicate", 5)],
      placementMode: "near-parent",
      updates: 50, // límite alto a propósito: no debería llegar ahí
      seed: 1,
      catastrophe: { intervalGenerations: 1, severity: 1 }, // extinción garantizada en la generación 1 (no dispara en la 0)
    };

    const repository = new InMemoryRunRepository();
    const run = await repository.createRun({ config: {}, seed: 1 });
    const socket = new FakeSocket();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(run.id, config, repository, socket as any, new PlaybackControl(0));

    const snapshotMessages = socket.sent.filter((m) => m.type === "snapshot");
    expect(snapshotMessages.length).toBeLessThan(50);
    expect(snapshotMessages.length).toBeGreaterThan(0);

    const lastSnapshotMessage = snapshotMessages.at(-1);
    expect(lastSnapshotMessage?.type === "snapshot" && lastSnapshotMessage.snapshot.extinct).toBe(true);

    expect(socket.sent.at(-1)).toEqual({ type: "done" });
    expect(socket.closed).toBe(true);

    // Se persistió exactamente lo que se transmitió, no más.
    const persisted = await repository.listSnapshots(run.id);
    expect(persisted).toHaveLength(snapshotMessages.length);
  });
});

describe("streamRunLive — pausar congela el motor, no solo el envío (RF-023/RNF-003)", () => {
  function buildConfig(seed: number): SimulationConfig {
    return {
      gridWidth: 6,
      gridHeight: 6,
      baseCyclesPerUpdate: 20,
      mutationRate: 0.05,
      ancestorGenomes: [createUniformGenome("replicate", 12)],
      placementMode: "near-parent",
      updates: 15,
      seed,
    };
  }

  it("una espera REAL de reloj mientras está pausado no cambia ni un snapshot del resultado final", async () => {
    const seed = 777;

    // Corrida A: control de referencia, de punta a punta sin pausar.
    const repoA = new InMemoryRunRepository();
    const runA = await repoA.createRun({ config: {}, seed });
    const socketA = new FakeSocket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runA.id, buildConfig(seed), repoA, socketA as any, new PlaybackControl(0));

    // Corrida B: misma config y semilla, pero arranca YA pausada (antes de
    // que streamRunLive calcule la generación 0) y solo se reanuda después
    // de una espera real de setTimeout — no una espera simulada/mockeada.
    // Si pausar no congelara advanceGeneration de verdad, esta espera real
    // introduciría una fuente de no-determinismo (RNF-003) que este test
    // detectaría como una diferencia entre A y B.
    const repoB = new InMemoryRunRepository();
    const runB = await repoB.createRun({ config: {}, seed });
    const socketB = new FakeSocket();
    const controlB = new PlaybackControl(0);
    controlB.pause();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamPromiseB = streamRunLive(runB.id, buildConfig(seed), repoB, socketB as any, controlB);

    expect(socketB.sent.filter((m) => m.type === "snapshot")).toHaveLength(0); // nada avanzó todavía, sigue en pausa

    await new Promise((resolve) => setTimeout(resolve, 300)); // espera real de reloj
    controlB.resume();
    await streamPromiseB;

    const snapshotsA = socketA.sent.filter((m) => m.type === "snapshot");
    const snapshotsB = socketB.sent.filter((m) => m.type === "snapshot");
    expect(snapshotsA).toHaveLength(15);
    expect(snapshotsB).toEqual(snapshotsA);
  });

  it("una pausa a mitad de corrida tampoco cambia el resto de las generaciones", async () => {
    const seed = 888;

    const repoA = new InMemoryRunRepository();
    const runA = await repoA.createRun({ config: {}, seed });
    const socketA = new FakeSocket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(runA.id, buildConfig(seed), repoA, socketA as any, new PlaybackControl(0));

    const repoB = new InMemoryRunRepository();
    const runB = await repoB.createRun({ config: {}, seed });
    const socketB = new FakeSocket();
    const controlB = new PlaybackControl(5); // pacing chico pero no-cero, para poder pausar "a mitad de camino"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamPromiseB = streamRunLive(runB.id, buildConfig(seed), repoB, socketB as any, controlB);

    // Espera a que hayan llegado algunas generaciones, pausa, espera de
    // verdad, y reanuda — igual que un usuario pausando a mitad de corrida.
    while (socketB.sent.filter((m) => m.type === "snapshot").length < 5) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    controlB.pause();
    const pausedCount = socketB.sent.filter((m) => m.type === "snapshot").length;

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(socketB.sent.filter((m) => m.type === "snapshot")).toHaveLength(pausedCount); // nada avanzó durante la pausa

    controlB.resume();
    await streamPromiseB;

    const snapshotsA = socketA.sent.filter((m) => m.type === "snapshot");
    const snapshotsB = socketB.sent.filter((m) => m.type === "snapshot");
    expect(snapshotsB).toEqual(snapshotsA);
  });
});

/** Repositorio con saveSnapshot controlable: demora artificial y/o falla en generaciones elegidas. */
class ControllableRepository extends InMemoryRunRepository {
  constructor(
    private readonly delayMs: number,
    private readonly failGenerations: ReadonlySet<number> = new Set(),
  ) {
    super();
  }

  override async saveSnapshot(runId: string, generation: number, snapshot: Record<string, unknown>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failGenerations.has(generation)) {
      throw new Error(`fallo simulado en generación ${generation}`);
    }
    return super.saveSnapshot(runId, generation, snapshot);
  }
}

describe("streamRunLive — saveSnapshot no bloquea el envío (Fase 5, cierre de la prueba de carga)", () => {
  function buildConfig(seed: number, updates: number): SimulationConfig {
    return {
      gridWidth: 5,
      gridHeight: 5,
      baseCyclesPerUpdate: 20,
      mutationRate: 0.05,
      ancestorGenomes: [createUniformGenome("replicate", 5)],
      placementMode: "near-parent",
      updates,
      seed,
    };
  }

  it("una escritura lenta no retrasa el envío de los snapshots siguientes", async () => {
    const WRITE_DELAY_MS = 150;
    const UPDATES = 4;
    const repository = new ControllableRepository(WRITE_DELAY_MS);
    const run = await repository.createRun({ config: {}, seed: 1 });
    const socket = new FakeSocket();

    const start = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(run.id, buildConfig(1, UPDATES), repository, socket as any, new PlaybackControl(0));
    const totalMs = Date.now() - start;

    expect(socket.sent.filter((m) => m.type === "snapshot")).toHaveLength(UPDATES);
    // Si cada escritura bloqueara el envío, el total sería >= UPDATES * WRITE_DELAY_MS
    // (4 * 150 = 600ms). Al no bloquear, las escrituras corren en paralelo entre sí —
    // el total debería acercarse a UN solo WRITE_DELAY_MS, no a la suma de los cuatro.
    expect(totalMs).toBeLessThan(UPDATES * WRITE_DELAY_MS);
  });

  it("por más lenta que sea la escritura, streamRunLive no resuelve hasta que todas terminan (o fallan)", async () => {
    const WRITE_DELAY_MS = 100;
    const UPDATES = 3;
    const repository = new ControllableRepository(WRITE_DELAY_MS);
    const run = await repository.createRun({ config: {}, seed: 2 });
    const socket = new FakeSocket();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamRunLive(run.id, buildConfig(2, UPDATES), repository, socket as any, new PlaybackControl(0));

    // Para cuando streamRunLive resolvió, todas las escrituras (que arrancaron
    // casi simultáneas) ya tuvieron tiempo de sobra para terminar.
    const persisted = await repository.listSnapshots(run.id);
    expect(persisted).toHaveLength(UPDATES);
  });

  it("un fallo de escritura se loguea con runId y generación, y no interrumpe el resto de la corrida", async () => {
    const UPDATES = 5;
    const FAILING_GENERATION = 2;
    const repository = new ControllableRepository(0, new Set([FAILING_GENERATION]));
    const run = await repository.createRun({ config: {}, seed: 3 });
    const socket = new FakeSocket();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await streamRunLive(run.id, buildConfig(3, UPDATES), repository, socket as any, new PlaybackControl(0));

      // La corrida completa igual, generación fallida incluida — el fallo de
      // persistencia no es visible para el cliente WS, solo para el operador.
      expect(socket.sent.filter((m) => m.type === "snapshot")).toHaveLength(UPDATES);
      expect(socket.sent.at(-1)).toEqual({ type: "done" });

      // El rastro del fallo existe: no es una pérdida silenciosa.
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [message] = consoleErrorSpy.mock.calls[0] as [string, unknown];
      expect(message).toContain(run.id);
      expect(message).toContain(String(FAILING_GENERATION));

      // Todas las generaciones MENOS la que falló quedaron persistidas.
      const persisted = await repository.listSnapshots(run.id);
      const persistedGenerations = persisted.map((s: GenerationSnapshotRecord) => s.generation);
      expect(persistedGenerations).toEqual([0, 1, 3, 4]);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
