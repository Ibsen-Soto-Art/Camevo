import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createUniformGenome } from "../../src/engine/organism/genome";
import { streamRunLive } from "../../src/api/ws/live-run";
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
    await streamRunLive(run.id, config, repository, socket as any, 0);

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
