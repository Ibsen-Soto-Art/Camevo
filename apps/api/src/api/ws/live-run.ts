import type { LiveMessage } from "@camevo/shared-types";
import type { WebSocket } from "ws";
import { RunRepository } from "../../persistence/repository/types";
import { SimulationConfig, advanceGeneration, createSimulationState } from "../../simulation/orchestrator/run";
import { PlaybackControl } from "./playback-control";

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
 *
 * Fase 4: si la población se extingue (`snapshot.extinct`), el loop
 * corta ahí mismo — igual que `runSimulation` — en vez de seguir
 * transmitiendo generaciones vacías hasta `config.updates`. El socket
 * cierra igual con el mensaje "done" normal: la razón del corte ya es
 * explícita en el último snapshot recibido (`extinct: true`), no hace
 * falta un tipo de mensaje aparte.
 *
 * RF-023: `control.waitIfPaused()` se consulta ANTES de llamar a
 * `advanceGeneration` en cada vuelta — mientras está pausado, el motor
 * literalmente no avanza (ver playback-control.ts para la garantía de
 * determinismo). El chequeo de `closed` se repite después de esperar,
 * por si el socket se cerró mientras estaba pausado.
 */
export async function streamRunLive(
  runId: string,
  config: SimulationConfig,
  repository: RunRepository,
  socket: WebSocket,
  control: PlaybackControl,
): Promise<void> {
  let closed = false;
  socket.on("close", () => {
    closed = true;
  });

  const state = createSimulationState(config);

  for (let i = 0; i < config.updates && !closed; i++) {
    await control.waitIfPaused();
    if (closed) break;

    const snapshot = advanceGeneration(state);
    await repository.saveSnapshot(runId, snapshot.generation, snapshot as unknown as Record<string, unknown>);

    if (socket.readyState === socket.OPEN) {
      const message: LiveMessage = { type: "snapshot", snapshot };
      socket.send(JSON.stringify(message));
    }

    if (snapshot.extinct) break;

    await sleep(control.msPerGeneration);
  }

  if (!closed && socket.readyState === socket.OPEN) {
    const message: LiveMessage = { type: "done" };
    socket.send(JSON.stringify(message));
    socket.close();
  }
}
