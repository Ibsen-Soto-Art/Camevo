import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { streamRunLive } from "../../src/api/ws/live-run";
import { PlaybackControl } from "../../src/api/ws/playback-control";
import { InMemoryRunRepository } from "../../src/persistence/repository/in-memory-repository";
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
