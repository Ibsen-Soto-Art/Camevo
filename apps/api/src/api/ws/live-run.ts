import type { LiveMessage } from "@camevo/shared-types";
import type { WebSocket } from "ws";
import { RunRepository } from "../../persistence/repository/types";
import { SimulationConfig, advanceGeneration, createSimulationState } from "../../simulation/orchestrator/run";

export type { LiveMessage };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Avanza una corrida generación a generación, con una pausa entre cada
 * una, transmitiendo cada snapshot por el socket y persistiéndolo — así
 * el streaming es perceptible en tiempo real (docs/03-arquitectura.md,
 * flujo de datos) en vez de recibirse todo de golpe al terminar.
 *
 * Simplificación deliberada de esta fase: cada conexión WS conduce su
 * propia ejecución desde la generación 0 (no hay reanudar-donde-quedó ni
 * múltiples espectadores compartiendo una corrida en curso) — coherente
 * con el supuesto de bajo volumen de usuarios concurrentes de
 * 02-requisitos.md §4.
 */
export async function streamRunLive(
  runId: string,
  config: SimulationConfig,
  repository: RunRepository,
  socket: WebSocket,
  msPerGeneration = 80,
): Promise<void> {
  let closed = false;
  socket.on("close", () => {
    closed = true;
  });

  const state = createSimulationState(config);

  for (let i = 0; i < config.updates && !closed; i++) {
    const snapshot = advanceGeneration(state);
    await repository.saveSnapshot(runId, snapshot.generation, snapshot as unknown as Record<string, unknown>);

    if (socket.readyState === socket.OPEN) {
      const message: LiveMessage = { type: "snapshot", snapshot };
      socket.send(JSON.stringify(message));
    }

    await sleep(msPerGeneration);
  }

  if (!closed && socket.readyState === socket.OPEN) {
    const message: LiveMessage = { type: "done" };
    socket.send(JSON.stringify(message));
    socket.close();
  }
}
