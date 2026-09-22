import type { LiveMessage } from "@camevo/shared-types";
import type { WebSocket } from "ws";
import { LiveRunRegistry } from "../live-run-registry";
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
 *
 * Grupo 1 (guardado intencional, identidad por navegador): esta función
 * YA NO escribe a Postgres en absoluto — antes (Fase 5) guardaba cada
 * snapshot automáticamente generación a generación (con un fix de
 * causalidad confirmada para que esa escritura no bloqueara el envío;
 * ver el historial en docs/04-roadmap-fases.md). Ese mecanismo entero
 * dejó de existir, no solo se optimizó: las corridas ya no se persisten
 * solas, solo cuando el usuario hace click en "Guardar esta corrida"
 * (`POST /runs/:id/save`, ver api/rest/app.ts). Acá, cada snapshot se
 * acumula en el `LiveRunRegistry` (memoria, barato) en vez de escribirse
 * a la base — `registry.appendSnapshot` reemplaza a `repository.saveSnapshot`.
 *
 * `registry.attachState(runId, state)` expone el `SimulationState` en
 * vivo (con el genoma y `tasksSolved` reales de cada organismo, que
 * nunca se persisten ni viajan por WS — ver RF-027 en live-run-registry.ts)
 * para que `api/rest` pueda servir el detalle de un organismo bajo
 * demanda. `registry.markFinished(runId)` en el `finally` es la garantía
 * real: sin importar CÓMO termine esta función (corrida completa,
 * extinción, socket cerrado a mitad de camino, una excepción), queda
 * registrado que el streaming terminó — desde ahí arranca el reloj de
 * limpieza si nadie guarda la corrida (ver el TTL en live-run-registry.ts).
 */
export async function streamRunLive(
  runId: string,
  config: SimulationConfig,
  socket: WebSocket,
  control: PlaybackControl,
  registry: LiveRunRegistry,
): Promise<void> {
  let closed = false;
  socket.on("close", () => {
    closed = true;
  });

  const state = createSimulationState(config);
  registry.attachState(runId, state);

  try {
    for (let i = 0; i < config.updates && !closed; i++) {
      await control.waitIfPaused();
      if (closed) break;

      const snapshot = advanceGeneration(state);
      registry.appendSnapshot(runId, snapshot);

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
  } finally {
    registry.markFinished(runId);
  }
}
